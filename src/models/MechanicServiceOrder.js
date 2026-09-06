const mongoose = require("mongoose");

const diagnosisSchema = new mongoose.Schema(
  {
    leaks: { type: String, trim: true, default: "" },
    faultCodes: { type: String, trim: true, default: "" },
    engine: { type: String, trim: true, default: "" },
    brakes: { type: String, trim: true, default: "" },
    suspension: { type: String, trim: true, default: "" },
    battery: { type: String, trim: true, default: "" },
    tires: { type: String, trim: true, default: "" },
    cooling: { type: String, trim: true, default: "" },
    wearComponents: { type: String, trim: true, default: "" },
    oxidation: { type: String, trim: true, default: "" },
    nextService: { type: String, trim: true, default: "" },
    overallState: { type: String, trim: true, default: "" },
    complementaryServices: {
      type: [String],
      default: [],
    },
    bodyDamage: { type: String, trim: true, default: "" },
    questionNotes: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    inspectionItems: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    measurements: {
      tireFl: { type: Number, default: null },
      tireFr: { type: Number, default: null },
      tireRl: { type: Number, default: null },
      tireRr: { type: Number, default: null },
      brakeFront: { type: Number, default: null },
      brakeRear: { type: Number, default: null },
      brakeOverall: { type: Number, default: null },
      suspensionLeft: { type: Number, default: null },
      suspensionRight: { type: Number, default: null },
      suspensionOverall: { type: Number, default: null },
      alignmentNote: { type: String, trim: true, maxlength: 400, default: "" },
      paintImpurities: { type: String, trim: true, default: "" },
      paintSanding: { type: String, trim: true, default: "" },
      paintOrangePeel: { type: String, trim: true, default: "" },
    },
    inspectionFindings: { type: String, trim: true, maxlength: 4000, default: "" },
    observations: { type: String, trim: true, maxlength: 4000, default: "" },
  },
  { _id: false }
);

const photoSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const mechanicServiceOrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 40,
    },
    status: {
      type: String,
      enum: ["open", "diagnosis_saved", "closed"],
      default: "open",
      index: true,
    },
    sourceType: {
      type: String,
      enum: ["appointment_client_vehicle", "appointment_maintenance", "walk_in"],
      required: true,
    },
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    vehicle: {
      brand: { type: String, trim: true, default: "" },
      model: { type: String, trim: true, default: "" },
      version: { type: String, trim: true, default: "" },
      year: { type: String, trim: true, default: "" },
      plate: { type: String, trim: true, uppercase: true, default: "" },
      color: { type: String, trim: true, default: "" },
      vehicleClass: { type: String, trim: true, default: "" },
      bodyType: { type: String, trim: true, default: "" },
      fuel: { type: String, trim: true, default: "" },
      paintType: { type: String, trim: true, default: "" },
      serviceType: { type: String, trim: true, default: "" },
      engineNumber: { type: String, trim: true, uppercase: true, default: "" },
      chassisNumber: { type: String, trim: true, uppercase: true, default: "" },
      serialNumber: { type: String, trim: true, uppercase: true, default: "" },
      cylinderCapacity: { type: String, trim: true, default: "" },
      transmissionType: { type: String, trim: true, default: "" },
      nationality: { type: String, trim: true, default: "" },
    },
    client: {
      name: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
    },
    appointmentDate: { type: Date, default: null },
    appointmentTime: { type: String, trim: true, maxlength: 5, default: "" },
    currentKm: { type: Number, default: null },
    nextServiceKm: { type: Number, default: null },
    diagnosis: {
      type: diagnosisSchema,
      default: () => ({}),
    },
    photos: {
      type: [photoSchema],
      default: [],
      validate: {
        validator(value) {
          return !Array.isArray(value) || value.length <= 10;
        },
        message: "Máximo 10 fotos por diagnóstico",
      },
    },
    technicianName: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    technicianSignatureUrl: {
      type: String,
      trim: true,
      default: "",
    },
    billing: {
      billedAmount: { type: Number, default: null },
      partsCost: { type: Number, default: null },
      laborCost: { type: Number, default: null },
      serviceCost: { type: Number, default: null },
      profit: { type: Number, default: null },
      currency: { type: String, trim: true, uppercase: true, default: "COP" },
      notes: { type: String, trim: true, maxlength: 1000, default: "" },
      pricedAt: { type: Date, default: null },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

mechanicServiceOrderSchema.index({ appointmentDate: 1, status: 1 });
mechanicServiceOrderSchema.index({ createdAt: -1 });

module.exports = mongoose.model("MechanicServiceOrder", mechanicServiceOrderSchema);
