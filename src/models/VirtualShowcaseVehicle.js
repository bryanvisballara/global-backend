const mongoose = require("mongoose");

const showroomImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 180,
    },
  },
  { _id: false }
);

const virtualShowcaseVehicleSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    model: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    version: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    year: {
      type: Number,
      min: 1900,
      max: 2100,
    },
    mileage: {
      type: Number,
      min: 0,
    },
    engine: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    horsepower: {
      type: Number,
      min: 0,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: "COP",
      maxlength: 8,
    },
    exteriorColor: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    interiorColor: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 3000,
    },
    immediatePurchase: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["available", "reserved", "sold"],
      default: "available",
    },
    images: {
      type: [showroomImageSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one image is required",
      },
      default: [],
    },
    listedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("VirtualShowcaseVehicle", virtualShowcaseVehicleSchema);
