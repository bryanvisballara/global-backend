const mongoose = require("mongoose");

const tierSchema = new mongoose.Schema(
  {
    minServices: { type: Number, required: true, min: 0 },
    maxServices: { type: Number, default: null },
    ratePerService: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const workshopPaymentPlanSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "Plan mecánico taller" },
    currency: { type: String, trim: true, uppercase: true, default: "COP" },
    windowDays: { type: Number, default: 15, min: 1, max: 90 },
    tiers: {
      type: [tierSchema],
      default: () => [
        { minServices: 0, maxServices: 5, ratePerService: 150000 },
        { minServices: 6, maxServices: 10, ratePerService: 130000 },
        { minServices: 11, maxServices: 20, ratePerService: 120000 },
        { minServices: 21, maxServices: 30, ratePerService: 110000 },
        { minServices: 31, maxServices: null, ratePerService: 100000 },
      ],
    },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WorkshopPaymentPlan", workshopPaymentPlanSchema);
