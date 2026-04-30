const mongoose = require("mongoose");
const { TRACKING_STATE_TEMPLATES } = require("../constants/trackingSteps");

const mediaItemSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "document"],
      required: true,
    },
    category: {
      type: String,
      enum: ["document", "photo-single", "photo-carousel", "video"],
      default: undefined,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 280,
    },
    caption: {
      type: String,
      trim: true,
      maxlength: 280,
    },
    clientVisible: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const deletionRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    requestedByRole: {
      type: String,
      trim: true,
      default: "",
    },
    requestedAt: {
      type: Date,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedByRole: {
      type: String,
      trim: true,
      default: "",
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const orderTrackingEventSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    orderRegion: {
      type: String,
      enum: ["latam", "usa"],
      required: true,
      index: true,
    },
    stepKey: {
      type: String,
      required: true,
      enum: TRACKING_STATE_TEMPLATES.map((step) => step.key),
      index: true,
    },
    stateKey: {
      type: String,
      required: true,
      enum: TRACKING_STATE_TEMPLATES.map((step) => step.key),
      index: true,
    },
    stateLabel: {
      type: String,
      required: true,
      trim: true,
    },
    stateIndex: {
      type: Number,
      required: true,
      min: 0,
      max: TRACKING_STATE_TEMPLATES.length - 1,
    },
    stateCode: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    title: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },
    location: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },
    media: {
      type: [mediaItemSchema],
      default: [],
    },
    clientVisible: {
      type: Boolean,
      default: false,
    },
    inProgress: {
      type: Boolean,
      default: false,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    deletionRequest: {
      type: deletionRequestSchema,
      default: () => ({ status: "none" }),
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "orderTrackingEvents",
  }
);

orderTrackingEventSchema.index({
  orderRegion: 1,
  orderId: 1,
  stateKey: 1,
  stepKey: 1,
  createdAt: 1,
  _id: 1,
});

module.exports = mongoose.model("OrderTrackingEvent", orderTrackingEventSchema);