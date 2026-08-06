const Post = require("../models/Post");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");
const { sendPendingPublishedPostNotifications, sendPublishedPostNotifications } = require("../services/pushNotificationService");
const {
  countDraftPosts,
  generateGlobalDraft,
  getRegenerateQuotaStatus,
  regenerateExistingDraft,
  QuotaExceededError,
} = require("../services/postsAuto.service");

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function normalizeMedia(media = []) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .filter((item) => item && item.url && item.type)
    .map((item) => ({
      type: item.type,
      url: String(item.url).trim(),
      caption: item.caption ? String(item.caption).trim() : undefined,
    }));
}

function inferMediaType(url, preferredFormat = "") {
  const normalizedUrl = String(url || "").toLowerCase();

  if (preferredFormat === "video") {
    return "video";
  }

  if (normalizedUrl.match(/\.(mp4|mov|m4v|webm)(\?|$)/)) {
    return "video";
  }

  return "image";
}

function parseMediaUrls(rawValue, preferredFormat = "") {
  if (!rawValue) {
    return [];
  }

  return String(rawValue)
    .split(/\n|,/) 
    .map((item) => item.trim())
    .filter(Boolean)
    .map((url) => ({
      type: inferMediaType(url, preferredFormat),
      url,
    }));
}

function parseJsonArrayField(rawValue, fallback = []) {
  if (!rawValue) {
    return fallback;
  }

  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  try {
    const parsedValue = JSON.parse(String(rawValue));
    return Array.isArray(parsedValue) ? parsedValue : fallback;
  } catch {
    return fallback;
  }
}

function buildOrderedMediaCollection(existingMedia = [], uploadedMedia = [], rawOrder = []) {
  const orderedTokens = parseJsonArrayField(rawOrder, []);
  const existingByToken = new Map(
    normalizeMedia(existingMedia).map((item, index) => [`existing:${index}`, item])
  );
  const uploadedByToken = new Map(
    normalizeMedia(uploadedMedia).map((item, index) => [`new:${index}`, item])
  );

  if (!orderedTokens.length) {
    return [...existingByToken.values(), ...uploadedByToken.values()];
  }

  const finalMedia = [];

  orderedTokens.forEach((token) => {
    const normalizedToken = String(token || "").trim();

    if (existingByToken.has(normalizedToken)) {
      finalMedia.push(existingByToken.get(normalizedToken));
      existingByToken.delete(normalizedToken);
      return;
    }

    if (uploadedByToken.has(normalizedToken)) {
      finalMedia.push(uploadedByToken.get(normalizedToken));
      uploadedByToken.delete(normalizedToken);
    }
  });

  return [
    ...finalMedia,
    ...existingByToken.values(),
    ...uploadedByToken.values(),
  ];
}

function isSupportedVideoUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const parsedUrl = new URL(String(value).trim());
    const host = parsedUrl.hostname.toLowerCase();
    const isYoutubeHost = host.includes("youtube.com") || host.includes("youtu.be");
    const isVimeoHost = host.includes("vimeo.com");
    const isCloudinaryHost = host.includes("res.cloudinary.com");
    const isDirectVideoFile = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(parsedUrl.pathname || "");
    return isYoutubeHost || isVimeoHost || isCloudinaryHost || isDirectVideoFile;
  } catch {
    return false;
  }
}

async function uploadFilesToCloudinary(files = []) {
  if (!files.length) {
    return [];
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  const uploadedAssets = await Promise.all(
    files.map(async (file) => {
      const result = await uploadBufferToCloudinary(file);

      return {
        type: result.resource_type === "video" ? "video" : "image",
        url: result.secure_url,
        caption: file.originalname ? String(file.originalname).replace(/\.[^.]+$/, "") : undefined,
      };
    })
  );

  return uploadedAssets;
}

function validateMediaByFormat(format, media) {
  if (!media.length) {
    throw new Error("Add at least one media file before publishing");
  }

  if (format === "image") {
    if (media.length !== 1 || media[0].type !== "image") {
      throw new Error("Single image format requires exactly one image");
    }

    return;
  }

  if (format === "carousel") {
    if (media.length < 2 || media.some((item) => item.type !== "image")) {
      throw new Error("Carousel format requires at least two images");
    }

    return;
  }

  if (format === "video" && (media.length !== 1 || media[0].type !== "video")) {
    throw new Error("Video format requires exactly one video");
  }
}

async function publishDueScheduledPosts() {
  const duePosts = await Post.find({
    status: "scheduled",
    scheduledFor: { $lte: new Date() },
  }).select("_id scheduledFor");

  if (!duePosts.length) {
    return 0;
  }

  await Post.bulkWrite(
    duePosts.map((post) => ({
      updateOne: {
        filter: { _id: post._id },
        update: {
          $set: {
            status: "published",
            publishedAt: post.scheduledFor || new Date(),
          },
        },
      },
    }))
  );

  const publishedPosts = await Post.find({
    _id: { $in: duePosts.map((post) => post._id) },
    status: "published",
    pushNotificationSentAt: null,
  }).populate("publishedBy", "name email role");

  await Promise.all(
    publishedPosts.map((post) =>
      sendPublishedPostNotifications(post).catch((error) => {
        console.error(`[push] Scheduled post ${String(post?._id)} failed`, error?.message || error);
        return null;
      })
    )
  );

  await sendPendingPublishedPostNotifications({ maxAgeHours: 72, limit: 25 }).catch((error) => {
    console.error("[push] Pending published post notifications failed", error?.message || error);
  });

  return duePosts.length;
}

async function createPost(req, res) {
  try {
    const { title, body, format, mediaUrls, videoUrl, videoSource, status, scheduledFor } = req.body;

    if (!title || !body || !format) {
      return res.status(400).json({ message: "title, body and format are required" });
    }

    const normalizedVideoSource = format === "video" ? (videoSource === "link" ? "link" : "file") : "file";

    if (format === "video" && normalizedVideoSource === "link" && !isSupportedVideoUrl(videoUrl)) {
      return res.status(400).json({ message: "Provide a valid YouTube, Vimeo or video URL" });
    }

    const uploadedMedia = await uploadFilesToCloudinary(req.files || []);
    const fallbackMedia = parseMediaUrls(
      format === "video" && normalizedVideoSource === "link" ? videoUrl : mediaUrls,
      format
    );
    const finalMedia = normalizeMedia(uploadedMedia.length ? uploadedMedia : fallbackMedia);
    const finalStatus =
      status === "scheduled" ? "scheduled" : status === "draft" ? "draft" : "published";
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;

    if (finalStatus === "scheduled") {
      if (!isValidDate(scheduledDate)) {
        return res.status(400).json({ message: "scheduledFor is required for scheduled posts" });
      }

      if (scheduledDate <= new Date()) {
        return res.status(400).json({ message: "Schedule time must be in the future" });
      }
    }

    validateMediaByFormat(format, finalMedia);

    const post = await Post.create({
      title: title.trim(),
      body: body.trim(),
      format,
      media: finalMedia,
      status: finalStatus,
      scheduledFor: finalStatus === "scheduled" ? scheduledDate : null,
      publishedAt: finalStatus === "published" ? new Date() : null,
      publishedBy: req.user._id,
    });

    const populatedPost = await Post.findById(post._id).populate("publishedBy", "name email role");

    let pushResult = null;

    if (finalStatus === "published") {
      pushResult = await sendPublishedPostNotifications(populatedPost).catch((error) => {
        console.error(`[push] Create post ${String(populatedPost?._id)} failed`, error?.message || error);
        return { sent: 0, skipped: 0, error: error?.message || "push failed" };
      });
    }

    return res.status(201).json({
      message: "Post created successfully",
      post: populatedPost,
      push: pushResult,
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message || "Error creating post" });
  }
}

async function listPosts(req, res) {
  try {
    await publishDueScheduledPosts();

    const posts = await Post.find()
      .populate("publishedBy", "name email role")
      .sort({ scheduledFor: 1, publishedAt: -1, createdAt: -1 });

    return res.status(200).json({ posts });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching posts" });
  }
}

async function getPost(req, res) {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId).populate("publishedBy", "name email role");

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    return res.status(200).json({ post });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error fetching post" });
  }
}

async function updatePost(req, res) {
  try {
    const { postId } = req.params;
    const { title, body, format: requestedFormat } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: "title and body are required" });
    }

    const existingPost = await Post.findById(postId).populate("publishedBy", "name email role");

    if (!existingPost) {
      return res.status(404).json({ message: "Post not found" });
    }

    const nextFormat = String(requestedFormat || existingPost.format || "").trim() || existingPost.format;
    const uploadedMedia = await uploadFilesToCloudinary(req.files || []);
    const rawExistingMedia = parseJsonArrayField(req.body.existingMedia, existingPost.media || []);
    const hasMediaPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "existingMedia") || uploadedMedia.length > 0;
    const nextMedia = hasMediaPayload
      ? buildOrderedMediaCollection(rawExistingMedia, uploadedMedia, req.body.mediaOrder)
      : normalizeMedia(existingPost.media || []);

    validateMediaByFormat(nextFormat, nextMedia);

    const post = await Post.findByIdAndUpdate(
      postId,
      {
        $set: {
          title: title.trim(),
          body: body.trim(),
          format: nextFormat,
          media: nextMedia,
        },
      },
      { new: true, runValidators: true }
    ).populate("publishedBy", "name email role");

    return res.status(200).json({
      message: "Post updated successfully",
      post,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating post" });
  }
}

async function deletePost(req, res) {
  try {
    const { postId } = req.params;
    const deletedPost = await Post.findByIdAndDelete(postId);

    if (!deletedPost) {
      return res.status(404).json({ message: "Post not found" });
    }

    return res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting post" });
  }
}

async function listDrafts(req, res) {
  try {
    const drafts = await Post.find({ status: "draft" })
      .populate("publishedBy", "name email role")
      .sort({ createdAt: -1 })
      .limit(80);

    return res.status(200).json({ posts: drafts });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching drafts" });
  }
}

async function getDraftCount(req, res) {
  try {
    const count = await countDraftPosts();
    return res.status(200).json({ count });
  } catch (error) {
    return res.status(500).json({ message: "Error counting drafts" });
  }
}

async function publishDraft(req, res) {
  try {
    const { postId } = req.params;
    const draft = await Post.findOne({ _id: postId, status: "draft" });

    if (!draft) {
      return res.status(404).json({ message: "Borrador no encontrado" });
    }

    draft.status = "published";
    draft.publishedAt = new Date();
    draft.scheduledFor = null;
    await draft.save();

    const populatedPost = await Post.findById(draft._id).populate("publishedBy", "name email role");
    const pushResult = await sendPublishedPostNotifications(populatedPost).catch((error) => {
      console.error(`[push] Publish draft ${String(populatedPost?._id)} failed`, error?.message || error);
      return { sent: 0, skipped: 0, error: error?.message || "push failed" };
    });

    return res.status(200).json({
      message: "Borrador publicado correctamente",
      post: populatedPost,
      push: pushResult,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error publishing draft" });
  }
}

async function generateDraft(req, res) {
  try {
    const force = String(req.body?.force || req.query?.force || "").trim() === "true";
    const result = await generateGlobalDraft({
      slotKey: force ? `manual-${Date.now()}` : "",
      force,
    });

    return res.status(result.skipped ? 200 : 201).json({
      message: result.skipped ? result.reason : "Borrador generado correctamente",
      skipped: Boolean(result.skipped),
      post: result.draft,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error generating draft" });
  }
}

async function getRegenerateQuota(req, res) {
  try {
    const quota = await getRegenerateQuotaStatus();
    return res.status(200).json({ quota });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error reading regenerate quota" });
  }
}

async function regenerateDraft(req, res) {
  try {
    const { postId } = req.params;
    const result = await regenerateExistingDraft(postId, {
      userId: req.user?._id || req.user?.id || null,
    });

    return res.status(200).json({
      message: "Noticia regenerada correctamente",
      post: result.draft,
      quota: result.quota,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError || error.code === "REGENERATE_QUOTA_EXCEEDED") {
      return res.status(429).json({
        message: error.message,
        quota: error.quota || null,
      });
    }

    return res.status(error.statusCode || 500).json({
      message: error.message || "Error regenerating draft",
    });
  }
}

module.exports = {
  createPost,
  deletePost,
  generateDraft,
  getDraftCount,
  getPost,
  getRegenerateQuota,
  listDrafts,
  listPosts,
  publishDraft,
  publishDueScheduledPosts,
  regenerateDraft,
  updatePost,
};