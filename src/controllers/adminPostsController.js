const Post = require("../models/Post");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");

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

async function createPost(req, res) {
  try {
    const { title, body, format, mediaUrls, status } = req.body;

    if (!title || !body || !format) {
      return res.status(400).json({ message: "title, body and format are required" });
    }

    const uploadedMedia = await uploadFilesToCloudinary(req.files || []);
    const fallbackMedia = parseMediaUrls(mediaUrls, format);

    const post = await Post.create({
      title: title.trim(),
      body: body.trim(),
      format,
      media: normalizeMedia(uploadedMedia.length ? uploadedMedia : fallbackMedia),
      status: status || "published",
      publishedBy: req.user._id,
    });

    const populatedPost = await Post.findById(post._id).populate("publishedBy", "name email role");

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
    const posts = await Post.find().populate("publishedBy", "name email role").sort({ createdAt: -1 });

    return res.status(200).json({ posts });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching posts" });
  }
}

module.exports = {
  createPost,
  listPosts,
};