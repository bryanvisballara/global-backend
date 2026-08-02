const mongoose = require("mongoose");

const cotizadorMarketingLeadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 180,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "",
    },
    identification: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    vehicleLabel: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
    },
    followUpAt: {
      type: Date,
      required: true,
      index: true,
    },
    source: {
      type: String,
      trim: true,
      default: "cotizador",
      maxlength: 40,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

cotizadorMarketingLeadSchema.index({ email: 1, followUpAt: 1 });

module.exports = mongoose.model("CotizadorMarketingLead", cotizadorMarketingLeadSchema);
