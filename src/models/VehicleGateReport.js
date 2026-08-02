const mongoose = require("mongoose");

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, maxlength: 400, default: "" },
  },
  { _id: false }
);

const personSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true, default: "" },
    documentId: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    relationship: { type: String, trim: true, default: "" },
    signatureUrl: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const accessorySchema = new mongoose.Schema(
  {
    key: { type: String, trim: true, required: true },
    label: { type: String, trim: true, required: true },
    present: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 240, default: "" },
  },
  { _id: false }
);

const vehicleGateReportSchema = new mongoose.Schema(
  {
    entryNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 40,
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    direction: {
      type: String,
      enum: ["entry", "exit", "both"],
      default: "entry",
    },
    entryDate: { type: Date, default: null, index: true },
    entryTime: { type: String, trim: true, maxlength: 5, default: "" },
    exitDate: { type: Date, default: null },
    exitTime: { type: String, trim: true, maxlength: 5, default: "" },
    shift: {
      type: String,
      enum: ["morning", "afternoon", "night", ""],
      default: "",
    },
    vehicle: {
      plate: { type: String, trim: true, uppercase: true, default: "" },
      vin: { type: String, trim: true, uppercase: true, default: "" },
      brand: { type: String, trim: true, default: "" },
      model: { type: String, trim: true, default: "" },
      year: { type: String, trim: true, default: "" },
      color: { type: String, trim: true, default: "" },
      version: { type: String, trim: true, default: "" },
      mileage: { type: Number, default: null },
      fuelType: {
        type: String,
        enum: ["gasoline", "diesel", "hybrid", "electric", "other", ""],
        default: "",
      },
      arrivalMethod: {
        type: String,
        enum: ["own", "tow", "transporter", "other", ""],
        default: "",
      },
      departureMethod: {
        type: String,
        enum: ["own", "tow", "transporter", "other", ""],
        default: "",
      },
    },
    documentsReceived: {
      type: [String],
      default: [],
    },
    accessories: {
      type: [accessorySchema],
      default: [],
    },
    entryObservations: { type: String, trim: true, maxlength: 4000, default: "" },
    exitObservations: { type: String, trim: true, maxlength: 4000, default: "" },
    generalObservations: { type: String, trim: true, maxlength: 4000, default: "" },
    entryPhotos: { type: [photoSchema], default: [] },
    exitPhotos: { type: [photoSchema], default: [] },
    deliverer: { type: personSchema, default: () => ({}) },
    securityReceiver: { type: personSchema, default: () => ({}) },
    exitDeliverer: { type: personSchema, default: () => ({}) },
    exitReceiver: { type: personSchema, default: () => ({}) },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vehicleGateReportSchema.index({ "vehicle.plate": 1, createdAt: -1 });
vehicleGateReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model("VehicleGateReport", vehicleGateReportSchema);
