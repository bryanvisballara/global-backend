const mongoose = require("mongoose");

const showroomVisitSchema = new mongoose.Schema(
  {
    visitorName: { type: String, required: true, trim: true, maxlength: 160 },
    visitorPhone: { type: String, trim: true, maxlength: 40, default: "" },
    visitorEmail: { type: String, trim: true, lowercase: true, maxlength: 180, default: "" },
    visitorDocument: { type: String, trim: true, maxlength: 80, default: "" },
    visitDate: { type: Date, required: true, index: true },
    visitTime: { type: String, trim: true, maxlength: 5, default: "" },
    purpose: {
      type: String,
      enum: ["showroom", "delivery", "pickup", "other"],
      default: "showroom",
    },
    vehicleInterest: {
      brand: { type: String, trim: true, default: "" },
      model: { type: String, trim: true, default: "" },
      year: { type: String, trim: true, default: "" },
      version: { type: String, trim: true, default: "" },
    },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    status: {
      type: String,
      enum: ["scheduled", "completed", "cancelled", "no_show"],
      default: "scheduled",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

showroomVisitSchema.index({ visitDate: 1, status: 1 });

module.exports = mongoose.model("ShowroomVisit", showroomVisitSchema);
