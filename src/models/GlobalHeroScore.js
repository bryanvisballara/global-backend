const mongoose = require("mongoose");

const globalHeroScoreSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    playerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

globalHeroScoreSchema.index({ score: -1, createdAt: -1 });

module.exports = mongoose.model("GlobalHeroScore", globalHeroScoreSchema);
