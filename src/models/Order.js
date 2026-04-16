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
    clientVisible: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const trackingUpdateSchema = new mongoose.Schema(
  {
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
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
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
    inProgress: {
      type: Boolean,
      default: false,
    },
    confirmed: {
      type: Boolean,
      default: false,
    },
    clientVisible: {
      type: Boolean,
      default: false,
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
    updates: {
      type: [trackingUpdateSchema],
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
      exteriorColor: {
        type: String,
        trim: true,
      },
      interiorColor: {
        type: String,
        trim: true,
      },
      destination: {
        type: String,
        enum: ["Puerto Santa Marta", "Puerto Cartagena", "Puerto Barranquilla"],
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
      default: Date.now,
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
    trackingEventCollectionEnabled: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    deletionRequest: {
      type: deletionRequestSchema,
      default: () => ({ status: "none" }),
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