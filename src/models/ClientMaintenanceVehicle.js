const mongoose = require("mongoose");

const clientMaintenanceVehicleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
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
      trim: true,
      maxlength: 120,
    },
    year: {
      type: Number,
      min: 1900,
      max: 2100,
      required: true,
    },
    currentMileage: {
      type: Number,
      min: 0,
      required: true,
    },
    usualDailyKm: {
      type: Number,
      min: 10,
      max: 200,
      required: true,
    },
    plate: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    lastPreventiveMaintenanceDate: {
      type: Date,
      required: true,
    },
    adminContactStatus: {
      type: String,
      enum: ["pending", "contacted", "will_service", "serviced_elsewhere", "not_interested", "appointment_scheduled"],
      default: "pending",
    },
    adminContactNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    adminLastContactAt: {
      type: Date,
      default: null,
    },
    adminAppointmentDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ClientMaintenanceVehicle", clientMaintenanceVehicleSchema);
