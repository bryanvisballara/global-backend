const { randomInt } = require("crypto");
const Client = require("../models/Client");
const ClientGlobalUS = require("../models/ClientGlobalUS");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const OrderGlobalUS = require("../models/OrderGlobalUS");
const User = require("../models/User");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");
const { normalizeTrackingStates } = require("../constants/trackingSteps");
const { addMonths } = require("../utils/date");
const {
  ADMIN_NOTIFICATION_ROLES,
  sendTrackingUpdateAdminNotifications,
  sendTrackingUpdateNotifications,
} = require("../services/pushNotificationService");
const { sendOrderTrackingUpdateEmail } = require("../services/orderTrackingEmailService");

const USA_ADMIN_ROLES = new Set(["gerenteUSA", "adminUSA"]);
const LATAM_LOCKED_STEP_KEYS = new Set(["order-received", "vehicle-search", "booking-and-shipping"]);

function isUsaAdministrativeRole(role) {
  return USA_ADMIN_ROLES.has(String(role || ""));
}

function resolveOrderRegionByRole(role) {
  return isUsaAdministrativeRole(role) ? "usa" : "latam";
}

function canModifyTrackingStep(role, stepKey) {
  const normalizedRole = String(role || "");
  const normalizedStepKey = String(stepKey || "");

  if (!normalizedStepKey) {
    return false;
  }

  if (isUsaAdministrativeRole(normalizedRole)) {
    // Permitir a admin/gerente USA editar los tres primeros y el último estado
    const allStepKeys = [
      "order-received",
      "vehicle-search",
      "booking-and-shipping",
      "in-transit",
      "nationalization",
      "port-exit",
      "vehicle-preparation",
      "delivery",
      "registration",
    ];
    const lastStepKey = allStepKeys[allStepKeys.length - 1];
    if (LATAM_LOCKED_STEP_KEYS.has(normalizedStepKey) || normalizedStepKey === lastStepKey) {
      return true;
    }
    return false;
  }
  return !LATAM_LOCKED_STEP_KEYS.has(normalizedStepKey);
}

function resolveOrderModelForCreate(role) {
  return isUsaAdministrativeRole(role) ? OrderGlobalUS : Order;
}

function resolveClientModelForCreate(role) {
  return isUsaAdministrativeRole(role) ? ClientGlobalUS : Client;
}

async function findOrderForRole(orderId, role) {
  const isUsaRole = isUsaAdministrativeRole(role);

  if (isUsaRole) {
    const usaOrder = await OrderGlobalUS.findById(orderId);

    if (usaOrder) {
      return { order: usaOrder, orderModel: OrderGlobalUS, region: "usa" };
    }

    const latamOrder = await Order.findById(orderId);

    if (latamOrder) {
      return { order: latamOrder, orderModel: Order, region: "latam" };
    }

    return { order: null, orderModel: null, region: null };
  }

  const latamOrder = await Order.findById(orderId);

  if (!latamOrder) {
    return { order: null, orderModel: null, region: null };
  }

  return { order: latamOrder, orderModel: Order, region: "latam" };
}

function getLatestConfirmedVisibleStep(steps = [], excludedStepKey = "") {
  return (steps || [])
    .filter((step) => step.confirmed && step.clientVisible && step.key !== excludedStepKey)
    .sort((left, right) => new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime())
    .slice(-1)[0] || null;
}

async function sendTrackingUpdateEmails(order, previousStep, updatedStep) {
  if (!updatedStep) {
    return { sent: 0, failed: 0 };
  }

  const recipientMap = new Map();
  const subscriberUserIds = new Set();
  const recipientEmails = new Set();

  function upsertRecipient(email, name = "", userId = "") {
    const normalizedEmail = String(email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return;
    }

    const normalizedUserId = String(userId || "").trim();
    const existingRecipient = recipientMap.get(normalizedEmail);

    recipientEmails.add(normalizedEmail);

    if (normalizedUserId) {
      subscriberUserIds.add(normalizedUserId);
    }

    recipientMap.set(normalizedEmail, {
      email: normalizedEmail,
      name: String(name || existingRecipient?.name || "").trim(),
      userId: normalizedUserId || existingRecipient?.userId || "",
    });
  }

  const clientEmail = String(order?.client?.email || "").toLowerCase().trim();
  const clientName = String(order?.client?.name || "").trim();

  if (clientEmail) {
    upsertRecipient(clientEmail, clientName || clientEmail);
  }

  for (const subscriber of order?.trackingSubscribers || []) {
    const email = String(subscriber?.email || "").toLowerCase().trim();
    if (!email) {
      continue;
    }

    upsertRecipient(email, "", subscriber?.user);
  }

  if (subscriberUserIds.size || recipientEmails.size) {
    const userQuery = [];

    if (subscriberUserIds.size) {
      userQuery.push({ _id: { $in: Array.from(subscriberUserIds) } });
    }

    if (recipientEmails.size) {
      userQuery.push({ email: { $in: Array.from(recipientEmails) } });
    }

    const linkedUsers = userQuery.length
      ? await User.find({ $or: userQuery }).select("_id name email")
      : [];

    const usersById = new Map();
    const usersByEmail = new Map();

    for (const user of linkedUsers) {
      const normalizedEmail = String(user?.email || "").toLowerCase().trim();
      const normalizedUserId = String(user?._id || "");

      if (normalizedUserId) {
        usersById.set(normalizedUserId, user);
      }

      if (normalizedEmail) {
        usersByEmail.set(normalizedEmail, user);
      }
    }

    for (const recipient of recipientMap.values()) {
      const matchedUser = usersById.get(recipient.userId) || usersByEmail.get(recipient.email);

      if (matchedUser?.name && !recipient.name) {
        recipient.name = String(matchedUser.name).trim();
      }
    }
  }

  const recipients = Array.from(recipientMap.values()).map(({ email, name }) => ({
    email,
    name: name || email,
  }));

  if (!recipients.length) {
    return { sent: 0, failed: 0 };
  }

  const vehicleLabel = [order?.vehicle?.brand, order?.vehicle?.model, order?.vehicle?.version]
    .filter(Boolean)
    .join(" ") || "tu vehículo";

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      sendOrderTrackingUpdateEmail({
        toEmail: recipient.email,
        toName: recipient.name,
        trackingNumber: order?.trackingNumber,
        vehicleLabel,
        previousStateLabel: previousStep?.label || "Inicio del proceso",
        nextStateLabel: updatedStep?.label || "Nuevo estado",
        stepNotes: updatedStep?.notes || "Tu vehículo sigue avanzando dentro del proceso de importación.",
      })
    )
  );

  let sent = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }

    failed += 1;
    console.error(
      `[tracking-email] Failed sending order tracking email to ${recipients[index]?.email || "unknown"} for ${
        order?.trackingNumber || "unknown-tracking"
      }`,
      result.reason
    );
  });

  return { sent, failed };
}

async function sendTrackingUpdateAdminEmails(order, previousStep, updatedStep) {
  if (!updatedStep) {
    return { sent: 0, failed: 0 };
  }

  const admins = await User.find({
    role: { $in: ADMIN_NOTIFICATION_ROLES },
    isActive: true,
    email: { $exists: true, $ne: null },
  }).select("name email");

  if (!admins.length) {
    return { sent: 0, failed: 0 };
  }

  const vehicleLabel = [order?.vehicle?.brand, order?.vehicle?.model, order?.vehicle?.version]
    .filter(Boolean)
    .join(" ") || "vehículo";
  const internalIdentifier = String(
    order?.vehicle?.internalIdentifier || order?.vehicle?.description || "Sin identificador"
  ).trim();
  const vin = String(order?.vehicle?.vin || "Sin VIN").trim();
  const results = await Promise.allSettled(
    admins.map((admin) =>
      sendOrderTrackingUpdateEmail({
        toEmail: admin.email,
        toName: admin.name || admin.email,
        trackingNumber: order?.trackingNumber,
        vehicleLabel: `${vehicleLabel} · INT ${internalIdentifier} · VIN ${vin}`,
        previousStateLabel: previousStep?.label || "Inicio del proceso",
        nextStateLabel: updatedStep?.label || "Nuevo estado",
        stepNotes: updatedStep?.notes || "El pedido recibió una nueva actualización de tracking.",
      })
    )
  );

  let sent = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }

    failed += 1;
    console.error(
      `[tracking-email-admin] Failed sending order tracking email to ${admins[index]?.email || "unknown"} for ${
        order?.trackingNumber || "unknown-tracking"
      }`,
      result.reason
    );
  });

  return { sent, failed };
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
      clientVisible: parseBooleanValue(item.clientVisible, true),
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

function serializeOrder(order, orderRegion = "latam") {
  const serializedOrder = order?.toObject ? order.toObject() : { ...(order || {}) };

  serializedOrder.trackingSteps = normalizeTrackingStates(serializedOrder.trackingSteps || []);
  serializedOrder.orderRegion = orderRegion;

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

function normalizeMediaVisibilityFingerprint(item = {}) {
  return {
    type: String(item.type || "").trim(),
    category: String(item.category || "").trim(),
    url: String(item.url || "").trim(),
    name: String(item.name || "").trim(),
    caption: String(item.caption || "").trim(),
  };
}

function isVisibilityOnlyMediaUpdate(currentMedia = [], nextMedia = []) {
  if (!Array.isArray(currentMedia) || !Array.isArray(nextMedia)) {
    return false;
  }

  if (currentMedia.length !== nextMedia.length) {
    return false;
  }

  return currentMedia.every((item, index) => {
    const currentFingerprint = normalizeMediaVisibilityFingerprint(item);
    const nextFingerprint = normalizeMediaVisibilityFingerprint(nextMedia[index]);

    return (
      currentFingerprint.type === nextFingerprint.type &&
      currentFingerprint.category === nextFingerprint.category &&
      currentFingerprint.url === nextFingerprint.url &&
      currentFingerprint.name === nextFingerprint.name &&
      currentFingerprint.caption === nextFingerprint.caption
    );
  });
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

  const trackingQuery = {
    trackingNumber: { $regex: `^${escapeRegex(normalizedTrackingNumber)}$`, $options: "i" },
  };

  const [latamOrder, usaOrder] = await Promise.all([
    Order.findOne(trackingQuery).select("_id trackingNumber"),
    OrderGlobalUS.findOne(trackingQuery).select("_id trackingNumber"),
  ]);

  return Boolean(latamOrder || usaOrder);
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
    const orderRegion = resolveOrderRegionByRole(req.user?.role);
    const OrderModel = resolveOrderModelForCreate(req.user?.role);
    const ClientModel = resolveClientModelForCreate(req.user?.role);
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

    if (
      orderRegion === "latam" &&
      !["Puerto Santa Marta", "Puerto Cartagena"].includes(String(vehicle.destination).trim())
    ) {
      return res.status(400).json({ message: "destination must be Puerto Santa Marta or Puerto Cartagena" });
    }

    const client = await ClientModel.findById(clientId);

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber);

    if (await trackingExists(normalizedTrackingNumber)) {
      return res.status(409).json({ message: "Tracking number already exists" });
    }

    const uploadedMedia = await uploadFilesToCloudinary(req.files || []);

    const order = await OrderModel.create({
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

    if (orderRegion === "latam") {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    const populatedOrder = await OrderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(201).json({
      message: "Order created successfully",
      order: serializeOrder(populatedOrder, orderRegion),
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
    if (isUsaAdministrativeRole(req.user?.role)) {
      const [latamOrders, usaOrders] = await Promise.all([
        Order.find().populate("client", "name email phone").populate("createdBy", "name email role"),
        OrderGlobalUS.find().populate("client", "name email phone").populate("createdBy", "name email role"),
      ]);

      const mergedOrders = latamOrders
        .map((order) => serializeOrder(order, "latam"))
        .concat(usaOrders.map((order) => serializeOrder(order, "usa")))
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

      return res.status(200).json({ orders: mergedOrders });
    }

    const orders = await Order.find()
      .populate("client", "name email phone")
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ orders: orders.map((order) => serializeOrder(order, "latam")) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching orders" });
  }
}

async function getOrder(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user?.role);

    if (!orderResult.order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = await orderResult.orderModel.findById(req.params.orderId)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({ order: serializeOrder(order, orderResult.region) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching order" });
  }
}

async function updateOrder(req, res) {
  try {
    const { vehicle, purchaseDate, expectedArrivalDate, media, notes, status } = req.body;
    const orderResult = await findOrderForRole(req.params.orderId, req.user?.role);
    const order = orderResult.order;

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

    if (orderResult.region === "latam") {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Order updated successfully",
      order: serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating order" });
  }
}

async function updateTrackingState(req, res) {
  try {
    const { orderId, stepKey } = req.params;
    const { notes } = req.body;
    const orderResult = await findOrderForRole(orderId, req.user?.role);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.trackingSteps = normalizeTrackingStates(order.trackingSteps || []);

    const stepIndex = order.trackingSteps.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) {
      return res.status(404).json({ message: "Tracking state not found" });
    }

    const step = order.trackingSteps[stepIndex];
    const existingMedia = parseExistingMediaPayload(req.body.existingMedia);
    const uploadedFiles = req.files || [];
    const externalVideoMedia = parseTrackingVideoLinks(req.body.videoLinks);
    const requestedNotes = typeof notes === "string" ? notes.trim() : String(step.notes || "").trim();
    const requestedConfirmed = parseBooleanValue(req.body.confirmed, step.confirmed);
    const isVisibilityOnlyUpdate = (
      requestedNotes === String(step.notes || "").trim() &&
      requestedConfirmed === Boolean(step.confirmed) &&
      uploadedFiles.length === 0 &&
      externalVideoMedia.length === 0 &&
      isVisibilityOnlyMediaUpdate(step.media || [], existingMedia)
    );

    // Permitir a admin/gerente USA editar el último estado solo si es el creador del pedido
    const allStepKeys = [
      "order-received",
      "vehicle-search",
      "booking-and-shipping",
      "in-transit",
      "nationalization",
      "port-exit",
      "vehicle-preparation",
      "delivery",
      "registration",
    ];
    const lastStepKey = allStepKeys[allStepKeys.length - 1];
    const isLastStep = stepKey === lastStepKey;
    const isUsaRole = isUsaAdministrativeRole(req.user?.role);
    const isOrderCreator = order?.createdBy?.toString?.() === req.user?._id?.toString?.();
    if (!canModifyTrackingStep(req.user?.role, stepKey) && !isVisibilityOnlyUpdate) {
      if (!(isUsaRole && isLastStep && isOrderCreator)) {
        return res.status(403).json({ message: "No tienes permisos para modificar este estado" });
      }
    }

    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, step.key);
    const mediaMeta = parseTrackingMediaMeta(req.body.mediaMeta, uploadedFiles);
    const uploadedMedia = await uploadTrackingFilesToCloudinary(uploadedFiles, mediaMeta);

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

    // Automatizar agendamiento de mantenimiento si es LATAM y se confirma 'delivery'
    if (orderResult.region === "latam" && stepKey === "delivery" && step.confirmed) {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    const updatedStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === stepKey);

    await sendTrackingUpdateNotifications(updatedOrder, updatedStep, previousConfirmedStep).catch(() => null);
    await sendTrackingUpdateEmails(updatedOrder, previousConfirmedStep, updatedStep).catch(() => null);

    await sendTrackingUpdateAdminNotifications(updatedOrder, updatedStep).catch(() => null);
    await sendTrackingUpdateAdminEmails(updatedOrder, previousConfirmedStep, updatedStep).catch(() => null);

    return res.status(200).json({
      message: "Tracking state updated successfully",
      order: serializeOrder(updatedOrder, orderResult.region),
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