const mongoose = require("mongoose");
const {
  TRACKING_STATE_TEMPLATES,
  buildTrackingStates,
  normalizeTrackingStates,
} = require("../constants/trackingSteps");

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
  },
  { _id: false }
);

const trackingStepSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: TRACKING_STATE_TEMPLATES.map((step) => step.key),
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    confirmed: {
      type: Boolean,
      default: false,
    },
    clientVisible: {
      type: Boolean,
      default: true,
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
    confirmedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const trackingSubscriberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    subscribedAt: {
      type: Date,
      default: Date.now,
    },
    lastViewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
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
      version: {
        type: String,
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
      destination: {
        type: String,
        enum: ["Puerto Santa Marta", "Puerto Cartagena"],
        trim: true,
      },
      internalIdentifier: {
        type: String,
        trim: true,
        maxlength: 1000,
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
      default: buildTrackingStates,
      validate: {
        validator(steps) {
          return Array.isArray(steps) && steps.length === TRACKING_STATE_TEMPLATES.length;
        },
        message: "Orders must include the 9 tracking states",
      },
    },
    trackingSubscribers: {
      type: [trackingSubscriberSchema],
      default: [],
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

orderSchema.pre("validate", function normalizeOrderTrackingStates(next) {
  this.trackingSteps = normalizeTrackingStates(this.trackingSteps || []);
  next();
});

module.exports = mongoose.model("Order", orderSchema);