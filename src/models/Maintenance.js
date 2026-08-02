const mongoose = require("mongoose");

const vehicleSnapshotSchema = new mongoose.Schema(
  {
    brand: { type: String, trim: true, maxlength: 80, default: "" },
    model: { type: String, trim: true, maxlength: 80, default: "" },
    version: { type: String, trim: true, maxlength: 120, default: "" },
    year: { type: Number, min: 1900, max: 2100, default: null },
    vin: { type: String, trim: true, uppercase: true, maxlength: 32, default: "" },
    plate: { type: String, trim: true, uppercase: true, maxlength: 20, default: "" },
  },
  { _id: false }
);

const maintenanceSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
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
    source: {
      type: String,
      enum: ["order", "manual"],
      default: "order",
      index: true,
    },
    activationDate: {
      type: Date,
      default: null,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "due", "contacted", "completed"],
      default: "scheduled",
    },
    vehicleSnapshot: {
      type: vehicleSnapshotSchema,
      default: () => ({}),
    },
    contactName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "",
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 160,
      default: "",
    },
    lastNotificationAt: {
      type: Date,
      default: null,
    },
    contactNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    adminContactStatus: {
      type: String,
      enum: ["pending", "contacted", "will_service", "serviced_elsewhere", "not_interested", "appointment_scheduled"],
      default: "pending",
    },
    adminLastContactAt: {
      type: Date,
      default: null,
    },
    adminAppointmentDate: {
      type: Date,
      default: null,
    },
    adminAppointmentTime: {
      type: String,
      trim: true,
      default: "",
      maxlength: 5,
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
      default: "",
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

maintenanceSchema.index(
  { order: 1 },
  {
    unique: true,
    partialFilterExpression: { order: { $type: "objectId" } },
  }
);

module.exports = mongoose.model("Maintenance", maintenanceSchema);
