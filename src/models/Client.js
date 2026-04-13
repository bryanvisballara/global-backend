const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    identification: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    country: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "clients",
  }
);

module.exports = mongoose.model("Client", clientSchema);