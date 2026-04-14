const mongoose = require('mongoose');

const SignedDocumentSchema = new mongoose.Schema({
  clientName: { type: String, required: true },
  clientPhone: { type: String, required: true },
  clientEmail: { type: String, required: true },
  vehicle: { type: String, required: true }, // e.g. "Toyota Sequoia SR5"
  documentUrl: { type: String, required: true }, // URL o path al PDF firmado
  documentName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SignedDocument', SignedDocumentSchema);
