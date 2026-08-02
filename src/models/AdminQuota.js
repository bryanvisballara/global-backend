const mongoose = require("mongoose");

const adminQuotaSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    events: {
      type: [
        {
          at: { type: Date, default: Date.now },
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          postId: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

adminQuotaSchema.index({ key: 1, dateKey: 1 }, { unique: true });

module.exports = mongoose.model("AdminQuota", adminQuotaSchema);
