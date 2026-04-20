const mongoose = require("mongoose");

const deletedAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    role: {
      type: String,
      trim: true,
      maxlength: 40,
    },
    deletionSource: {
      type: String,
      trim: true,
      default: "self-service",
      maxlength: 80,
    },
    feedbackToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    recommendation: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    feedbackSubmittedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("DeletedAccount", deletedAccountSchema);