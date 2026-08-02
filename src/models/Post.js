const mongoose = require("mongoose");

const mediaItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video"],
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 280,
    },
  },
  { _id: false }
);

const postLikeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const postCommentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
    },
    likes: {
      type: [postLikeSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const postSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    format: {
      type: String,
      enum: ["carousel", "image", "video"],
      required: true,
    },
    media: {
      type: [mediaItemSchema],
      default: [],
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "published", "scheduled"],
      default: "published",
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    pushNotificationSentAt: {
      type: Date,
      default: null,
    },
    source: {
      url: { type: String, trim: true, default: "" },
      title: { type: String, trim: true, default: "" },
      publisher: { type: String, trim: true, default: "" },
      topic: { type: String, trim: true, default: "" },
      fetchedAt: { type: Date, default: null },
    },
    auto: {
      enabled: { type: Boolean, default: false },
      slotKey: { type: String, trim: true, default: "" },
      generatedAt: { type: Date, default: null },
      model: { type: String, trim: true, default: "" },
    },
    likes: {
      type: [postLikeSchema],
      default: [],
    },
    comments: {
      type: [postCommentSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ "auto.slotKey": 1 }, { sparse: true });
postSchema.index({ "source.url": 1 }, { sparse: true });

module.exports = mongoose.model("Post", postSchema);