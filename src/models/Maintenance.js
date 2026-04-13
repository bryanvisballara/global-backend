const mongoose = require("mongoose");

const maintenanceSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "due", "contacted", "completed"],
      default: "scheduled",
    },
    lastNotificationAt: {
      type: Date,
      default: null,
    },
    contactNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    reportedMileage: {
      type: Number,
      min: 0,
      default: null,
    },
    lastServiceDate: {
      type: Date,
      default: null,
    },
    clientNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    lastClientUpdateAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Maintenance", maintenanceSchema);