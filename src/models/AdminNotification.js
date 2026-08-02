const mongoose = require("mongoose");

const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "maintenance_appointment",
        "maintenance_completed",
        "visitor_created",
        "gate_entry",
        "gate_exit",
        "order_deletion_request",
        "client_created",
        "order_created",
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    body: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    deepLink: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    entityModel: {
      type: String,
      trim: true,
      default: "",
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    audienceRoles: {
      type: [String],
      default: ["admin", "manager"],
    },
    readBy: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    dismissedBy: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

adminNotificationSchema.index({ createdAt: -1 });
adminNotificationSchema.index({ "dismissedBy.user": 1, createdAt: -1 });
adminNotificationSchema.index({ "readBy.user": 1, createdAt: -1 });

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);
