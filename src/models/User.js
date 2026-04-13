const mongoose = require("mongoose");

const pushDeviceSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      enum: ["apns", "fcm"],
      required: true,
      trim: true,
    },
    appVersion: {
      type: String,
      trim: true,
    },
    lastRegisteredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["admin", "client"],
      default: "client",
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    identification: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    country: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    dismissedNotifications: {
      type: [String],
      default: [],
    },
    notificationBadgeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pushDevices: {
      type: [pushDeviceSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("User", userSchema);
