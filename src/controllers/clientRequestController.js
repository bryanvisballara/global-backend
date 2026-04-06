const ClientRequest = require("../models/ClientRequest");

async function createClientRequest(req, res) {
  try {
    const {
      clientId,
      customerName,
      customerEmail,
      customerPhone,
      vehicle,
      reservationAmount,
      currency,
      notes,
    } = req.body;

    if (!customerName || !customerEmail || !customerPhone || !vehicle || !vehicle.brand || !vehicle.model || reservationAmount == null) {
      return res.status(400).json({
        message: "customerName, customerEmail, customerPhone, vehicle and reservationAmount are required",
      });
    }

    const clientRequest = await ClientRequest.create({
      client: clientId || undefined,
      customerName: String(customerName).trim(),
      customerEmail: String(customerEmail).trim().toLowerCase(),
      customerPhone: String(customerPhone).trim(),
      vehicle: {
        brand: String(vehicle.brand).trim(),
        model: String(vehicle.model).trim(),
        color: vehicle.color ? String(vehicle.color).trim() : undefined,
        upholstery: vehicle.upholstery ? String(vehicle.upholstery).trim() : undefined,
        version: vehicle.version ? String(vehicle.version).trim() : undefined,
        year: vehicle.year ? Number(vehicle.year) : undefined,
      },
      reservationAmount: Number(reservationAmount),
      currency: currency ? String(currency).trim().toUpperCase() : undefined,
      notes: notes ? String(notes).trim() : undefined,
    });

    return res.status(201).json({
      message: "Client request created successfully",
      clientRequest,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error creating client request" });
  }
}

module.exports = {
  createClientRequest,
};