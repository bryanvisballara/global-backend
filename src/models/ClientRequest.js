const mongoose = require("mongoose");

const clientRequestSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    customerEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },
    vehicle: {
      brand: {
        type: String,
        required: true,
        trim: true,
      },
      model: {
        type: String,
        required: true,
        trim: true,
      },
      color: {
        type: String,
        trim: true,
      },
      upholstery: {
        type: String,
        trim: true,
      },
      version: {
        type: String,
        trim: true,
      },
      year: {
        type: Number,
        min: 1900,
      },
    },
    reservationAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: "VES",
      trim: true,
      uppercase: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ["new", "contacted", "converted", "closed"],
      default: "new",
    },
    source: {
      type: String,
      default: "client-portal",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ClientRequest", clientRequestSchema);