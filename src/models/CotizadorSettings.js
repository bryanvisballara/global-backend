const mongoose = require("mongoose");

const cotizadorSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default",
    },
    laborPrice: {
      type: Number,
      min: 0,
      default: 150000,
    },
    laborAlistamiento: {
      type: Number,
      min: 0,
      default: 30000,
    },
    currency: {
      type: String,
      trim: true,
      default: "COP",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CotizadorSettings", cotizadorSettingsSchema);
