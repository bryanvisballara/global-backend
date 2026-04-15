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
  const normalizedStepKey = String(stepKey || "");

  if (!normalizedStepKey) {
    return false;
  }

  return true;
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

function getLatestTrackingStepUpdate(step, matcher = null) {
  const updates = Array.isArray(step?.updates) ? step.updates : [];
  const matchingUpdates = typeof matcher === "function"
    ? updates.filter(matcher)
    : updates;

  return matchingUpdates.reduce((latestUpdate, currentUpdate) => {
    if (!latestUpdate) {
      return currentUpdate;
    }

    const latestTime = new Date(latestUpdate.updatedAt || latestUpdate.createdAt || 0).getTime();
    const currentTime = new Date(currentUpdate.updatedAt || currentUpdate.createdAt || 0).getTime();

    return currentTime >= latestTime ? currentUpdate : latestUpdate;
  }, null);
}

function buildTrackingStepSnapshot(step, update = null) {
  if (!step) {
    return null;
  }

  const resolvedUpdate = update || getLatestTrackingStepUpdate(step);

  return {
    ...step,
    notes: resolvedUpdate?.notes || step.notes || "",
    media: Array.isArray(resolvedUpdate?.media) ? resolvedUpdate.media : step.media || [],
    clientVisible: typeof resolvedUpdate?.clientVisible === "boolean"
      ? resolvedUpdate.clientVisible
      : Boolean(step.clientVisible),
    inProgress: typeof resolvedUpdate?.inProgress === "boolean"
      ? resolvedUpdate.inProgress
      : Boolean(step.inProgress),
    confirmed: typeof resolvedUpdate?.completed === "boolean"
      ? resolvedUpdate.completed
      : Boolean(step.confirmed),
    updatedAt: resolvedUpdate?.updatedAt || resolvedUpdate?.createdAt || step.updatedAt || null,
    confirmedAt: resolvedUpdate?.completed
      ? resolvedUpdate.updatedAt || resolvedUpdate.createdAt || step.confirmedAt || null
      : step.confirmedAt || null,
  };
}
function getLatestConfirmedVisibleStep(steps = [], excludedStepKey = "") {
  return (steps || [])
    .map((step) => buildTrackingStepSnapshot(step, getLatestTrackingStepUpdate(step, (update) => update.completed && update.clientVisible)))
    .filter((step) => step?.confirmed && step?.clientVisible && step.key !== excludedStepKey)
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
    return normalizeMedia(parsedValue).map((item, index) => ({
      ...item,
      updateIndex: parseTrackingUpdateIndex(parsedValue[index]?.updateIndex),
    }));
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

function buildTrackingMediaFingerprint(item = {}) {
  return [
    String(item.updateIndex ?? "").trim(),
    String(item.category || "").trim().toLowerCase(),
    String(item.url || "").trim(),
    String(item.name || "").trim().toLowerCase(),
    String(item.caption || "").trim().toLowerCase(),
  ].join("::");
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

function parseTrackingUpdateIndex(value) {
  const parsedValue = Number.parseInt(String(value || ""), 10);
  return Number.isNaN(parsedValue) ? -1 : parsedValue;
}

function reconcileTrackingStepMedia(step, desiredMedia = []) {
  if (!step || !Array.isArray(step.updates) || !Array.isArray(desiredMedia) || !desiredMedia.length) {
    return;
  }

  const desiredMediaMap = new Map(
    desiredMedia.map((item) => [buildTrackingMediaFingerprint(item), item])
  );

  step.updates = step.updates.map((update, updateIndex) => ({
    ...update,
    media: normalizeMedia(update.media || [])
      .filter((item) => desiredMediaMap.has(buildTrackingMediaFingerprint({ ...item, updateIndex })))
      .map((item) => {
        const desiredEntry = desiredMediaMap.get(buildTrackingMediaFingerprint({ ...item, updateIndex })) || {};
        return {
          ...item,
          clientVisible: parseBooleanValue(desiredEntry.clientVisible, item.clientVisible),
        };
      }),
  }));
}

function hasTrackingUpdateChanges({ notes = "", media = [], requestedConfirmed = false, requestedInProgress = false, step }) {
  const trimmedNotes = String(notes || "").trim();

  if (trimmedNotes) {
    return true;
  }

  if (Array.isArray(media) && media.length) {
    return true;
  }

  if (requestedConfirmed !== Boolean(step?.confirmed)) {
    return true;
  }

  if (requestedInProgress !== Boolean(step?.inProgress)) {
    return true;
  }

  return false;
}

function syncTrackingStepProgression(steps = [], preferredActiveIndex = -1) {
  if (!Array.isArray(steps) || !steps.length) {
    return steps;
  }

  let resolvedActiveIndex = preferredActiveIndex;

  if (resolvedActiveIndex < 0 || steps[resolvedActiveIndex]?.confirmed) {
    resolvedActiveIndex = steps.findIndex((item) => !item.confirmed);
  }

  steps.forEach((item, index) => {
    if (item.confirmed) {
      item.inProgress = false;
      return;
    }

    item.inProgress = index === resolvedActiveIndex;
  });

  return steps;
}

function getLatestClientVisibleStepSnapshot(step) {
  return buildTrackingStepSnapshot(step, getLatestTrackingStepUpdate(step, (update) => update.clientVisible));
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

function normalizeOptionalString(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || undefined;
}

function resolveOrderPurchaseDate(value) {
  if (!value) {
    return new Date();
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
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
    const internalIdentifier = normalizeOptionalString(req.body.internalIdentifier || req.body.description);
    const destination = normalizeOptionalString(req.body.destination);
    const fallbackColor = normalizeOptionalString(req.body.color);
    const exteriorColor = normalizeOptionalString(req.body.exteriorColor) || fallbackColor;
    const interiorColor = normalizeOptionalString(req.body.interiorColor) || fallbackColor;
    const brand = normalizeOptionalString(req.body.brand);
    const model = normalizeOptionalString(req.body.model);
    const version = normalizeOptionalString(req.body.version);
    const trackingNumber = normalizeTrackingNumber(req.body.trackingNumber);
    const clientId = normalizeOptionalString(req.body.clientId);
    const purchaseDate = resolveOrderPurchaseDate(req.body.purchaseDate);
    const expectedArrivalDate = normalizeOptionalString(req.body.expectedArrivalDate);
    const parsedYear = Number.parseInt(String(req.body.year || "").trim(), 10);
    const vehicle = {
      brand,
      model,
      version,
      year: parsedYear,
      vin: normalizeOptionalString(req.body.vin),
      color: exteriorColor || interiorColor || fallbackColor,
      exteriorColor,
      interiorColor,
      destination,
      internalIdentifier,
    };

    if (
      !vehicle.brand ||
      !vehicle.model ||
      !vehicle.version ||
      Number.isNaN(vehicle.year) ||
      !trackingNumber ||
      !vehicle.destination ||
      (!vehicle.exteriorColor && !vehicle.interiorColor && !vehicle.color) ||
      !clientId
    ) {
      return res.status(400).json({
        message: "brand, model, version, year, trackingNumber, destination, color details and clientId are required",
      });
    }

    if (
      orderRegion === "latam" &&
      !["Puerto Santa Marta", "Puerto Cartagena", "Puerto Barranquilla"].includes(String(vehicle.destination).trim())
    ) {
      return res.status(400).json({ message: "destination must be Puerto Santa Marta, Puerto Cartagena or Puerto Barranquilla" });
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
        brand: vehicle.brand,
        model: vehicle.model,
        version: vehicle.version,
        year: vehicle.year,
        vin: vehicle.vin,
        color: vehicle.color,
        exteriorColor: vehicle.exteriorColor,
        interiorColor: vehicle.interiorColor,
        destination: vehicle.destination,
        internalIdentifier: vehicle.internalIdentifier,
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
    const requestedNotes = typeof notes === "string" ? notes.trim() : "";
    const requestedConfirmed = parseBooleanValue(req.body.confirmed, step.confirmed);
    const requestedInProgress = requestedConfirmed ? false : parseBooleanValue(req.body.inProgress, step.inProgress);
    const requestedClientVisible = parseBooleanValue(req.body.clientVisible, false);
    const requestedVisibilityOnly = parseBooleanValue(req.body.visibilityOnly, false);
    const forceCreateUpdate = !requestedVisibilityOnly && parseBooleanValue(req.body.forceCreateUpdate, false);
    const requestedUpdateIndex = parseTrackingUpdateIndex(req.body.updateIndex);

    if (!canModifyTrackingStep(req.user?.role, stepKey) && !requestedVisibilityOnly) {
      return res.status(403).json({ message: "No tienes permisos para modificar este estado" });
    }

    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, step.key);
    const updateShouldBeClientVisible = requestedVisibilityOnly ? requestedClientVisible : false;
    const mediaMeta = parseTrackingMediaMeta(req.body.mediaMeta, uploadedFiles);
    const uploadedMedia = await uploadTrackingFilesToCloudinary(uploadedFiles, mediaMeta);
    const appendedMedia = dedupeTrackingMedia(
      normalizeMedia([...uploadedMedia, ...externalVideoMedia]).map((item) => ({
        ...item,
        clientVisible: updateShouldBeClientVisible,
      }))
    );
    const isVisibilityOnlyUpdate = requestedVisibilityOnly || (
      !hasTrackingUpdateChanges({
        notes: requestedNotes,
        media: appendedMedia,
        requestedConfirmed,
        requestedInProgress,
        step,
      }) &&
      uploadedFiles.length === 0 &&
      externalVideoMedia.length === 0 &&
      isVisibilityOnlyMediaUpdate(step.media || [], existingMedia)
    );

    reconcileTrackingStepMedia(step, existingMedia);

    let clientPublishedStep = null;
    const resolvedVisibilityUpdateIndex = isVisibilityOnlyUpdate && Array.isArray(step.updates) && step.updates.length
      ? (requestedUpdateIndex >= 0 && step.updates[requestedUpdateIndex] ? requestedUpdateIndex : step.updates.length - 1)
      : -1;

    if (resolvedVisibilityUpdateIndex >= 0 && Array.isArray(step.updates) && step.updates[resolvedVisibilityUpdateIndex]) {
      const targetUpdate = step.updates[resolvedVisibilityUpdateIndex];
      const previouslyVisible = Boolean(targetUpdate.clientVisible);
      const visibilityChangedAt = new Date();

      targetUpdate.clientVisible = requestedClientVisible;
      targetUpdate.updatedAt = visibilityChangedAt;
      targetUpdate.media = normalizeMedia(targetUpdate.media || []).map((item) => ({
        ...item,
        clientVisible: requestedClientVisible,
      }));
      order.markModified("trackingSteps");

      if (!previouslyVisible && requestedClientVisible) {
        clientPublishedStep = buildTrackingStepSnapshot(step, targetUpdate);
      }
    } else if (forceCreateUpdate || hasTrackingUpdateChanges({
      notes: requestedNotes,
      media: appendedMedia,
      requestedConfirmed,
      requestedInProgress,
      step,
    })) {
      const now = new Date();
      const newUpdate = {
        notes: requestedNotes,
        media: appendedMedia,
        clientVisible: updateShouldBeClientVisible,
        inProgress: requestedConfirmed ? false : requestedInProgress,
        completed: requestedConfirmed,
        createdAt: now,
        updatedAt: now,
      };

      if (!Array.isArray(step.updates)) {
        step.updates = [];
      }

      step.updates.push(newUpdate);

      if (updateShouldBeClientVisible) {
        clientPublishedStep = buildTrackingStepSnapshot(step, newUpdate);
      }
    }

    step.confirmed = requestedConfirmed;
    step.inProgress = requestedConfirmed ? false : requestedInProgress;

    syncTrackingStepProgression(order.trackingSteps, step.inProgress ? stepIndex : -1);

    const latestUpdate = getLatestTrackingStepUpdate(step);
    const latestClientVisibleStep = getLatestClientVisibleStepSnapshot(step);
    step.clientVisible = Boolean(latestClientVisibleStep?.clientVisible);
    step.notes = latestUpdate?.notes || "";
    step.media = normalizeMedia(step.media || []);
    step.updatedAt = latestUpdate?.updatedAt || latestUpdate?.createdAt || step.updatedAt || new Date();
    step.confirmedAt = step.confirmed
      ? step.confirmedAt || latestUpdate?.updatedAt || latestUpdate?.createdAt || new Date()
      : null;
    order.status = order.trackingSteps.every((state) => state.confirmed) ? "completed" : "active";
    order.markModified("trackingSteps");

    await order.save();

    // Automatizar agendamiento de mantenimiento si es LATAM y se confirma 'delivery'
    if (orderResult.region === "latam" && stepKey === "delivery" && step.confirmed) {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    const updatedStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === stepKey);

    if (clientPublishedStep?.clientVisible) {
      await sendTrackingUpdateNotifications(updatedOrder, clientPublishedStep, previousConfirmedStep).catch(() => null);
      await sendTrackingUpdateEmails(updatedOrder, previousConfirmedStep, clientPublishedStep).catch(() => null);
    }

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