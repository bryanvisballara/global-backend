const Client = require("../models/Client");
const ClientGlobalUS = require("../models/ClientGlobalUS");

const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";

function normalizeRequesterRole(requester) {
  if (requester && typeof requester === "object") {
    return String(requester.role || "");
  }

  return String(requester || "");
}

function normalizeRequesterEmail(requester) {
  if (!requester || typeof requester !== "object") {
    return "";
  }

  return String(requester.email || "").trim().toLowerCase();
}

function isUsaAdministrativeRole(role) {
  return ["gerenteUSA", "adminUSA"].includes(String(role || ""));
}

function isAnthonyGlobalOwner(requester) {
  return normalizeRequesterRole(requester) === "manager" && normalizeRequesterEmail(requester) === ANTHONY_GLOBAL_OWNER_EMAIL;
}

function resolveClientModelByRole(role) {
  return isUsaAdministrativeRole(role) ? ClientGlobalUS : Client;
}

async function listClients(req, res) {
  try {
    if (isAnthonyGlobalOwner(req.user)) {
      const [latamClients, usaClients] = await Promise.all([
        Client.find().sort({ createdAt: -1 }),
        ClientGlobalUS.find().sort({ createdAt: -1 }),
      ]);

      const clients = latamClients
        .map((client) => {
          const plainClient = client?.toObject ? client.toObject() : { ...(client || {}) };
          return { ...plainClient, clientRegion: "latam" };
        })
        .concat(
          usaClients.map((client) => {
            const plainClient = client?.toObject ? client.toObject() : { ...(client || {}) };
            return { ...plainClient, clientRegion: "usa" };
          })
        )
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

      return res.status(200).json({ clients });
    }

    const ClientModel = resolveClientModelByRole(req.user?.role);
    const clients = await ClientModel.find().sort({ createdAt: -1 });

    return res.status(200).json({ clients });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching clients" });
  }
}

async function createClient(req, res) {
  try {
    const ClientModel = resolveClientModelByRole(req.user?.role);
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

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const normalizedEmail = String(email || "").toLowerCase().trim() || undefined;

    if (normalizedEmail) {
      const existingClient = await ClientModel.findOne({ email: normalizedEmail });

      if (existingClient) {
        return res.status(409).json({ message: "Client already exists" });
      }
    }

    const client = await ClientModel.create({
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