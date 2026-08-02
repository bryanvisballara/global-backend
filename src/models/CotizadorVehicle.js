const mongoose = require("mongoose");

const cotizadorVehiclePartSchema = new mongoose.Schema(
  {
    supply: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CotizadorSupply",
      required: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    quantityLabel: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "1",
    },
    quantityValue: {
      type: Number,
      min: 0,
      default: 1,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { _id: false }
);

const cotizadorVehicleSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      index: true,
    },
    variantLabel: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    engineCode: {
      type: String,
      trim: true,
      maxlength: 80,
      default: "",
      index: true,
    },
    yearFrom: {
      type: Number,
      min: 1980,
      max: 2100,
      default: null,
    },
    yearTo: {
      type: Number,
      min: 1980,
      max: 2100,
      default: null,
    },
    sourceFile: {
      type: String,
      trim: true,
      maxlength: 240,
      default: "",
    },
    laborPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    salePriceMode: {
      type: String,
      enum: ["fixed", "amount", "percent"],
    },
    salePriceValue: {
      type: Number,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    parts: {
      type: [cotizadorVehiclePartSchema],
      default: [],
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

cotizadorVehicleSchema.index({ brand: 1, model: 1, engineCode: 1, yearFrom: 1, yearTo: 1 });

module.exports = mongoose.model("CotizadorVehicle", cotizadorVehicleSchema);
