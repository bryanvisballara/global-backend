const mongoose = require("mongoose");

const SUPPLY_TYPES = [
  "oil",
  "oil_filter",
  "drain_plug_gasket",
  "engine_air_filter",
  "cabin_air_filter",
  "other",
];

const cotizadorSupplySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: SUPPLY_TYPES,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    specification: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
      index: true,
    },
    oemCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 80,
      default: "",
      index: true,
    },
    provider: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    stock: {
      type: Number,
      min: 0,
      default: 0,
    },
    unitCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 40,
      default: "und",
    },
    ignoreStock: {
      type: Boolean,
      default: false,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    link: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    searchKey: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      default: "",
    },
  },
  { timestamps: true }
);

cotizadorSupplySchema.index({ type: 1, oemCode: 1, specification: 1 });

module.exports = mongoose.model("CotizadorSupply", cotizadorSupplySchema);
module.exports.SUPPLY_TYPES = SUPPLY_TYPES;
