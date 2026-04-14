const SignedDocument = require('../models/SignedDocument');
const path = require('path');

// Guardar documento firmado
exports.uploadSignedDocument = async (req, res) => {
  try {
    const { clientName, clientPhone, clientEmail, vehicle } = req.body;
    if (!req.file) {
      return res.status(400).json({ message: 'No se subió ningún archivo.' });
    }
    const documentUrl = `/uploads/signed-documents/${req.file.filename}`;
    const documentName = req.file.originalname;
    const doc = new SignedDocument({
      clientName,
      clientPhone,
      clientEmail,
      vehicle,
      documentUrl,
      documentName
    });
    await doc.save();
    res.status(201).json({ message: 'Documento guardado', document: doc });
  } catch (err) {
    res.status(500).json({ message: 'Error al guardar documento', error: err.message });
  }
};

// Listar documentos firmados
exports.listSignedDocuments = async (req, res) => {
  try {
    const docs = await SignedDocument.find().sort({ createdAt: -1 });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: 'Error al listar documentos', error: err.message });
  }
};

// Descargar documento firmado
exports.downloadSignedDocument = async (req, res) => {
  try {
    const doc = await SignedDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });
    const filePath = path.join(__dirname, '../../', doc.documentUrl);
    res.download(filePath, doc.documentName);
  } catch (err) {
    res.status(500).json({ message: 'Error al descargar documento', error: err.message });
  }
};
