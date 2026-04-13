const { randomInt } = require("crypto");
const Client = require("../models/Client");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");
const { normalizeTrackingStates } = require("../constants/trackingSteps");
const { addMonths } = require("../utils/date");
const {
  sendTrackingUpdateAdminNotifications,
  sendTrackingUpdateNotifications,
} = require("../services/pushNotificationService");
const { sendOrderTrackingUpdateEmail } = require("../services/orderTrackingEmailService");

function getLatestConfirmedVisibleStep(steps = [], excludedStepKey = "") {
  return (steps || [])
    .filter((step) => step.confirmed && step.clientVisible && step.key !== excludedStepKey)
    .sort((left, right) => new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime())
    .slice(-1)[0] || null;
}

async function sendTrackingUpdateEmails(order, previousStep, updatedStep) {
  const recipientMap = new Map();

  const clientEmail = String(order?.client?.email || "").toLowerCase().trim();
  const clientName = String(order?.client?.name || "").trim();

  if (clientEmail) {
    recipientMap.set(clientEmail, { email: clientEmail, name: clientName || clientEmail });
  }

  for (const subscriber of order?.trackingSubscribers || []) {
    const email = String(subscriber?.email || "").toLowerCase().trim();
    if (!email) {
      continue;
    }

    if (!recipientMap.has(email)) {
      recipientMap.set(email, { email, name: email });
    }
  }

  const recipients = Array.from(recipientMap.values());

  if (!recipients.length) {
    return;
  }

  const vehicleLabel = [order?.vehicle?.brand, order?.vehicle?.model, order?.vehicle?.version]
    .filter(Boolean)
    .join(" ") || "tu vehículo";

  await Promise.all(
    recipients.map((recipient) =>
      sendOrderTrackingUpdateEmail({
        toEmail: recipient.email,
        toName: recipient.name,
        trackingNumber: order?.trackingNumber,
        vehicleLabel,
        previousStateLabel: previousStep?.label || "Inicio del proceso",
        nextStateLabel: updatedStep?.label || "Nuevo estado",
        stepNotes: updatedStep?.notes || "Tu vehículo sigue avanzando dentro del proceso de importación.",
      }).catch(() => null)
    )
  );
}

function normalizeMedia(media = []) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .filter((item) => item && item.url && item.type)
    .map((item) => ({
      type: item.type,
      category: item.category ? String(item.category).trim() : undefined,
      url: String(item.url).trim(),
      name: item.name ? String(item.name).trim() : undefined,
      caption: item.caption ? String(item.caption).trim() : undefined,
    }));
}

function parseBooleanValue(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();

    if (["true", "1", "yes", "on"].includes(normalizedValue)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalizedValue)) {
      return false;
    }
  }

  return fallback;
}

function inferFileMediaType(file, result) {
  if (file?.mimetype?.startsWith("video/") || result?.resource_type === "video") {
    return "video";
  }

  if (file?.mimetype?.startsWith("image/") || result?.resource_type === "image") {
    return "image";
  }

  return "document";
}

function serializeOrder(order) {
  const serializedOrder = order?.toObject ? order.toObject() : { ...(order || {}) };

  serializedOrder.trackingSteps = normalizeTrackingStates(serializedOrder.trackingSteps || []);

  return serializedOrder;
}

function parseExistingMediaPayload(value) {
  if (!value) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value);
    return normalizeMedia(parsedValue);
  } catch {
    return [];
  }
}

function dedupeTrackingMedia(media = []) {
  const seenKeys = new Set();

  return media.filter((item) => {
    const category = String(item.category || "").trim().toLowerCase();
    const nameKey = String(item.name || "").trim().toLowerCase();
    const captionKey = String(item.caption || "").trim().toLowerCase();
    const urlKey = String(item.url || "").trim();
    const fingerprint = nameKey || captionKey || urlKey;

    if (!fingerprint) {
      return false;
    }

    const dedupeKey = `${category}::${fingerprint}`;

    if (seenKeys.has(dedupeKey)) {
      return false;
    }

    seenKeys.add(dedupeKey);
    return true;
  });
}

function parseTrackingMediaMeta(value, files = []) {
  if (!value) {
    return files.map(() => ({}));
  }

  try {
    const parsedValue = JSON.parse(value);

    if (!Array.isArray(parsedValue)) {
      return files.map(() => ({}));
    }

    return files.map((file, index) => {
      const item = parsedValue[index] || {};
      return {
        category: item.category ? String(item.category).trim() : undefined,
        caption: item.caption ? String(item.caption).trim() : undefined,
      };
    });
  } catch {
    return files.map(() => ({}));
  }
}

function parseTrackingVideoLinks(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item))
    .map((url, index) => ({
      type: "video",
      category: "video",
      url,
      caption: `Video externo ${index + 1}`,
    }));
}

function normalizeTrackingNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function trackingExists(trackingNumber) {
  const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber);

  if (!normalizedTrackingNumber) {
    return false;
  }

  const existingOrder = await Order.findOne({
    trackingNumber: { $regex: `^${escapeRegex(normalizedTrackingNumber)}$`, $options: "i" },
  }).select("_id trackingNumber");

  return Boolean(existingOrder);
}

async function generateUniqueTrackingNumber() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `GI-${randomInt(100000, 100000000)}`;

    if (!(await trackingExists(candidate))) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique tracking number");
}

async function uploadFilesToCloudinary(files = []) {
  if (!files.length) {
    return [];
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  return Promise.all(
    files.map(async (file) => {
      const result = await uploadBufferToCloudinary(file, process.env.CLOUDINARY_ORDER_FOLDER || "global-app/orders");

      return {
        type: inferFileMediaType(file, result),
        url: result.secure_url,
        name: file.originalname,
        caption: file.originalname ? String(file.originalname).replace(/\.[^.]+$/, "") : undefined,
      };
    })
  );
}

async function uploadTrackingFilesToCloudinary(files = [], mediaMeta = []) {
  if (!files.length) {
    return [];
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  return Promise.all(
    files.map(async (file, index) => {
      const result = await uploadBufferToCloudinary(
        file,
        process.env.CLOUDINARY_TRACKING_FOLDER || "global-app/order-states"
      );
      const metadata = mediaMeta[index] || {};

      return {
        type: inferFileMediaType(file, result),
        category: metadata.category || (result.resource_type === "video" ? "video" : file.mimetype === "application/pdf" ? "document" : "photo-carousel"),
        url: result.secure_url,
        name: file.originalname,
        caption: metadata.caption || (file.originalname ? String(file.originalname).replace(/\.[^.]+$/, "") : undefined),
      };
    })
  );
}

async function syncMaintenanceSchedule(order, adminUserId) {
  if (!order.client) {
    await Maintenance.findOneAndDelete({ order: order._id });
    return;
  }

  const dueDate = addMonths(order.purchaseDate, 6);
  const status = dueDate <= new Date() ? "due" : "scheduled";

  await Maintenance.findOneAndUpdate(
    { order: order._id },
    {
      order: order._id,
      client: order.client,
      createdBy: adminUserId,
      dueDate,
      status,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function createOrder(req, res) {
  try {
    const internalIdentifier = req.body.internalIdentifier || req.body.description;
    const destination = req.body.destination;
    const vehicle = {
      brand: req.body.brand,
      model: req.body.model,
      version: req.body.version,
      year: req.body.year,
      vin: req.body.vin,
      color: req.body.color,
      destination,
      internalIdentifier,
    };
    const trackingNumber = req.body.trackingNumber;
    const purchaseDate = req.body.purchaseDate;
    const expectedArrivalDate = req.body.expectedArrivalDate;
    const clientId = req.body.clientId;

    if (
      !vehicle.brand ||
      !vehicle.model ||
      !vehicle.version ||
      !vehicle.year ||
      !trackingNumber ||
      !purchaseDate ||
      !vehicle.destination ||
      !vehicle.color ||
      !clientId
    ) {
      return res.status(400).json({
        message: "brand, model, version, year, trackingNumber, purchaseDate, destination, color and clientId are required",
      });
    }

    if (!["Puerto Santa Marta", "Puerto Cartagena"].includes(String(vehicle.destination).trim())) {
      return res.status(400).json({ message: "destination must be Puerto Santa Marta or Puerto Cartagena" });
    }

    const client = await Client.findById(clientId);

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber);

    if (await trackingExists(normalizedTrackingNumber)) {
      return res.status(409).json({ message: "Tracking number already exists" });
    }

    const uploadedMedia = await uploadFilesToCloudinary(req.files || []);

    const order = await Order.create({
      client: client._id,
      createdBy: req.user._id,
      trackingNumber: normalizedTrackingNumber,
      vehicle: {
        brand: String(vehicle.brand).trim(),
        model: String(vehicle.model).trim(),
        version: vehicle.version ? String(vehicle.version).trim() : undefined,
        year: Number(vehicle.year),
        vin: vehicle.vin ? String(vehicle.vin).trim() : undefined,
        color: vehicle.color ? String(vehicle.color).trim() : undefined,
        destination: vehicle.destination ? String(vehicle.destination).trim() : undefined,
        internalIdentifier: vehicle.internalIdentifier ? String(vehicle.internalIdentifier).trim() : undefined,
      },
      purchaseDate,
      expectedArrivalDate: expectedArrivalDate || undefined,
      media: normalizeMedia(uploadedMedia),
    });

    await syncMaintenanceSchedule(order, req.user._id);

    const populatedOrder = await Order.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(201).json({
      message: "Order created successfully",
      order: serializeOrder(populatedOrder),
    });
  } catch (error) {
    console.error("Error creating order", error);

    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message || "Error creating order" });
  }
}

async function suggestTrackingNumber(req, res) {
  try {
    const trackingNumber = await generateUniqueTrackingNumber();

    return res.status(200).json({ trackingNumber });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error generating tracking number" });
  }
}

async function listOrders(req, res) {
  try {
    const orders = await Order.find()
      .populate("client", "name email phone")
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ orders: orders.map((order) => serializeOrder(order)) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching orders" });
  }
}

async function getOrder(req, res) {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({ order: serializeOrder(order) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching order" });
  }
}

async function updateOrder(req, res) {
  try {
    const { vehicle, purchaseDate, expectedArrivalDate, media, notes, status } = req.body;
    const order = await Order.findById(req.params.orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (vehicle) {
      const normalizedVehicle = {
        ...vehicle,
      };

      if (normalizedVehicle.description && !normalizedVehicle.internalIdentifier) {
        normalizedVehicle.internalIdentifier = normalizedVehicle.description;
      }

      order.vehicle = {
        ...order.vehicle.toObject(),
        ...normalizedVehicle,
      };
    }

    if (purchaseDate) {
      order.purchaseDate = purchaseDate;
    }

    if (expectedArrivalDate) {
      order.expectedArrivalDate = expectedArrivalDate;
    }

    if (Array.isArray(media)) {
      order.media = normalizeMedia(media);
    }

    if (typeof notes === "string") {
      order.notes = notes.trim();
    }

    if (status) {
      order.status = status;
    }

    await order.save();
    await syncMaintenanceSchedule(order, req.user._id);

    const updatedOrder = await Order.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Order updated successfully",
      order: serializeOrder(updatedOrder),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating order" });
  }
}

async function updateTrackingState(req, res) {
  try {
    const { orderId, stepKey } = req.params;
    const { notes } = req.body;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.trackingSteps = normalizeTrackingStates(order.trackingSteps || []);

    const stepIndex = order.trackingSteps.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) {
      return res.status(404).json({ message: "Tracking state not found" });
    }

    const step = order.trackingSteps[stepIndex];
    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, step.key);
    const mediaMeta = parseTrackingMediaMeta(req.body.mediaMeta, req.files || []);
    const uploadedMedia = await uploadTrackingFilesToCloudinary(req.files || [], mediaMeta);
    const externalVideoMedia = parseTrackingVideoLinks(req.body.videoLinks);
    const existingMedia = parseExistingMediaPayload(req.body.existingMedia);

    if (typeof notes === "string") {
      step.notes = notes.trim();
    }

    step.confirmed = parseBooleanValue(req.body.confirmed, step.confirmed);
    step.clientVisible = parseBooleanValue(req.body.clientVisible, step.clientVisible);
    step.media = dedupeTrackingMedia(normalizeMedia([...existingMedia, ...uploadedMedia, ...externalVideoMedia]));
    step.confirmedAt = step.confirmed ? step.confirmedAt || new Date() : null;

    step.updatedAt = new Date();
    order.status = order.trackingSteps.every((state) => state.confirmed) ? "completed" : "active";

    await order.save();

    const updatedOrder = await Order.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    const updatedStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === stepKey);

    await sendTrackingUpdateNotifications(updatedOrder, updatedStep).catch(() => null);
    await sendTrackingUpdateEmails(updatedOrder, previousConfirmedStep, updatedStep).catch(() => null);

    await sendTrackingUpdateAdminNotifications(updatedOrder, updatedStep).catch(() => null);

    return res.status(200).json({
      message: "Tracking state updated successfully",
      order: serializeOrder(updatedOrder),
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: "Error updating tracking state" });
  }
}

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  suggestTrackingNumber,
  updateOrder,
  updateTrackingState,
};