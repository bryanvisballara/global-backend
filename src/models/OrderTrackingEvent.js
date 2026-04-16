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
    notes: {
      type: String,
      trim: true,
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
  stepKey: 1,
  createdAt: 1,
  _id: 1,
});

module.exports = mongoose.model("OrderTrackingEvent", orderTrackingEventSchema);