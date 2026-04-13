const Client = require("../models/Client");

async function listClients(req, res) {
  try {
    const clients = await Client.find().sort({ createdAt: -1 });

    return res.status(200).json({ clients });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching clients" });
  }
}

async function createClient(req, res) {
  try {
    const {
      name,
      email,
      phone,
      identification,
      address,
      city,
      country,
      notes,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingClient = await Client.findOne({ email: normalizedEmail });

    if (existingClient) {
      return res.status(409).json({ message: "Client already exists" });
    }

    const client = await Client.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : undefined,
      identification: identification ? String(identification).trim() : undefined,
      address: address ? String(address).trim() : undefined,
      city: city ? String(city).trim() : undefined,
      country: country ? String(country).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: "Client created successfully",
      client,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error creating client" });
  }
}

module.exports = {
  createClient,
  listClients,
};