const Post = require("../models/Post");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");
const { sendPublishedPostNotifications } = require("../services/pushNotificationService");

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
    publishedPosts.map((post) => sendPublishedPostNotifications(post).catch(() => null))
  );

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
    const finalStatus = status === "scheduled" ? "scheduled" : "published";
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

    if (finalStatus === "published") {
      await sendPublishedPostNotifications(populatedPost).catch(() => null);
    }

    return res.status(201).json({
      message: "Post created successfully",
      post: populatedPost,
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
    const { title, body } = req.body;

    if (!title || !body) {
      return res.status(400).json({ message: "title and body are required" });
    }

    const post = await Post.findByIdAndUpdate(
      postId,
      {
        $set: {
          title: title.trim(),
          body: body.trim(),
        },
      },
      { new: true, runValidators: true }
    ).populate("publishedBy", "name email role");

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

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

module.exports = {
  createPost,
  deletePost,
  getPost,
  listPosts,
  publishDueScheduledPosts,
  updatePost,
};