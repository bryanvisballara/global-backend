const mongoose = require("mongoose");
const { TRACKING_STEP_TEMPLATES, buildTrackingSteps } = require("../constants/trackingSteps");

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

const trackingStepSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: TRACKING_STEP_TEMPLATES.map((step) => step.key),
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "completed"],
      default: "pending",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    media: {
      type: [mediaItemSchema],
      default: [],
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    trackingNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    vehicle: {
      brand: {
        type: String,
        required: true,
        trim: true,
      },
      model: {
        type: String,
        required: true,
        trim: true,
      },
      year: {
        type: Number,
        required: true,
        min: 1900,
      },
      vin: {
        type: String,
        trim: true,
      },
      color: {
        type: String,
        trim: true,
      },
      description: {
        type: String,
        trim: true,
        maxlength: 1000,
      },
    },
    purchaseDate: {
      type: Date,
      required: true,
    },
    expectedArrivalDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["active", "completed", "cancelled"],
      default: "active",
    },
    media: {
      type: [mediaItemSchema],
      default: [],
    },
    trackingSteps: {
      type: [trackingStepSchema],
      default: buildTrackingSteps,
      validate: {
        validator(steps) {
          return Array.isArray(steps) && steps.length === TRACKING_STEP_TEMPLATES.length;
        },
        message: "Orders must include the 7 tracking steps",
      },
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Order", orderSchema);