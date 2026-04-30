const Client = require("../models/Client");
const ClientGlobalUS = require("../models/ClientGlobalUS");
const Order = require("../models/Order");
const OrderGlobalUS = require("../models/OrderGlobalUS");
const Maintenance = require("../models/Maintenance");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");

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

function normalizeClientPayload(payload = {}) {
  return {
    name: String(payload.name || "").trim(),
    email: String(payload.email || "").toLowerCase().trim() || undefined,
    phone: String(payload.phone || "").trim() || undefined,
    identification: String(payload.identification || "").trim() || undefined,
    address: String(payload.address || "").trim() || undefined,
    city: String(payload.city || "").trim() || undefined,
    country: String(payload.country || "").trim() || undefined,
    notes: String(payload.notes || "").trim() || undefined,
  };
}

function resolveClientResourcesForRequester(requester, client = null) {
  const isUsaClient = String(client?.clientRegion || "").trim().toLowerCase() === "usa";
  const requesterRole = requester?.role;

  if (isAnthonyGlobalOwner(requester) && isUsaClient) {
    return {
      ClientModel: ClientGlobalUS,
      OrderModel: OrderGlobalUS,
      clientRegion: "usa",
    };
  }

  if (isAnthonyGlobalOwner(requester) && !isUsaClient) {
    return {
      ClientModel: Client,
      OrderModel: Order,
      clientRegion: "latam",
    };
  }

  const isUsaRole = isUsaAdministrativeRole(requesterRole);

  return {
    ClientModel: isUsaRole ? ClientGlobalUS : Client,
    OrderModel: isUsaRole ? OrderGlobalUS : Order,
    clientRegion: isUsaRole ? "usa" : "latam",
  };
}

async function findClientForRequester(clientId, requester, clientRegion = "") {
  const resolvedRegion = String(clientRegion || "").trim().toLowerCase();
  const resources = resolveClientResourcesForRequester(requester, { clientRegion: resolvedRegion });
  const client = await resources.ClientModel.findById(clientId);

  if (!client) {
    return { client: null, ...resources };
  }

  return { client, ...resources };
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
    const normalizedPayload = normalizeClientPayload(req.body);
    const normalizedName = normalizedPayload.name;

    if (!normalizedName) {
      return res.status(400).json({ message: "Name is required" });
    }

    if (normalizedName.length < 2) {
      return res.status(400).json({ message: "Name must be at least 2 characters" });
    }

    const normalizedEmail = normalizedPayload.email;

    if (normalizedEmail) {
      const existingClient = await ClientModel.findOne({ email: normalizedEmail });

      if (existingClient) {
        return res.status(409).json({ message: "Client already exists" });
      }
    }

    const client = await ClientModel.create({
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPayload.phone,
      identification: normalizedPayload.identification,
      address: normalizedPayload.address,
      city: normalizedPayload.city,
      country: normalizedPayload.country,
      notes: normalizedPayload.notes,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: "Client created successfully",
      client,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Client already exists" });
    }

    if (error?.name === "ValidationError") {
      const validationMessage = Object.values(error.errors || {})
        .map((fieldError) => fieldError?.message)
        .find(Boolean);

      return res.status(400).json({ message: validationMessage || "Invalid client data" });
    }

    console.error("Error creating client", {
      role: req.user?.role || null,
      email: String(req.body?.email || "").trim().toLowerCase() || null,
      message: error?.message || error,
    });

    return res.status(500).json({ message: "Error creating client" });
  }
}

async function updateClient(req, res) {
  try {
    const clientId = String(req.params.clientId || "").trim();
    const clientRegion = String(req.body?.clientRegion || req.query?.clientRegion || "").trim();
    const { client, ClientModel } = await findClientForRequester(clientId, req.user, clientRegion);

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizedPayload = normalizeClientPayload(req.body);

    if (!normalizedPayload.name) {
      return res.status(400).json({ message: "Name is required" });
    }

    if (normalizedPayload.name.length < 2) {
      return res.status(400).json({ message: "Name must be at least 2 characters" });
    }

    if (normalizedPayload.email) {
      const existingClient = await ClientModel.findOne({
        email: normalizedPayload.email,
        _id: { $ne: client._id },
      });

      if (existingClient) {
        return res.status(409).json({ message: "Client already exists" });
      }
    }

    client.name = normalizedPayload.name;
    client.email = normalizedPayload.email;
    client.phone = normalizedPayload.phone;
    client.identification = normalizedPayload.identification;
    client.address = normalizedPayload.address;
    client.city = normalizedPayload.city;
    client.country = normalizedPayload.country;
    client.notes = normalizedPayload.notes;
    await client.save();

    return res.status(200).json({
      message: "Client updated successfully",
      client,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Client already exists" });
    }

    if (error?.name === "ValidationError") {
      const validationMessage = Object.values(error.errors || {})
        .map((fieldError) => fieldError?.message)
        .find(Boolean);

      return res.status(400).json({ message: validationMessage || "Invalid client data" });
    }

    return res.status(500).json({ message: "Error updating client" });
  }
}

async function deleteClient(req, res) {
  try {
    const clientId = String(req.params.clientId || "").trim();
    const clientRegion = String(req.body?.clientRegion || req.query?.clientRegion || "").trim();
    const { client, ClientModel, OrderModel, clientRegion: resolvedRegion } = await findClientForRequester(clientId, req.user, clientRegion);

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const [orderCount, maintenanceCount, maintenanceVehicleCount] = await Promise.all([
      OrderModel.countDocuments({ client: client._id }),
      resolvedRegion === "latam" ? Maintenance.countDocuments({ client: client._id }) : 0,
      resolvedRegion === "latam" ? ClientMaintenanceVehicle.countDocuments({ client: client._id }) : 0,
    ]);

    if (orderCount > 0 || maintenanceCount > 0 || maintenanceVehicleCount > 0) {
      return res.status(409).json({
        message: "No se puede eliminar el cliente porque tiene pedidos o registros asociados.",
      });
    }

    await ClientModel.findByIdAndDelete(client._id);

    return res.status(200).json({
      message: "Client deleted successfully",
      clientId,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error deleting client" });
  }
}

module.exports = {
  createClient,
  deleteClient,
  listClients,
  updateClient,
};