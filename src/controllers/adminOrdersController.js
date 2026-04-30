const { randomInt, randomUUID } = require("crypto");
const Client = require("../models/Client");
const ClientGlobalUS = require("../models/ClientGlobalUS");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const OrderGlobalUS = require("../models/OrderGlobalUS");
const OrderTrackingEvent = require("../models/OrderTrackingEvent");
const User = require("../models/User");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");
const { TRACKING_STATE_TEMPLATES, normalizeTrackingStates } = require("../constants/trackingSteps");
const { addMonths } = require("../utils/date");
const {
  ADMIN_NOTIFICATION_ROLES,
  sendTrackingUpdateAdminNotifications,
  sendTrackingUpdateNotifications,
} = require("../services/pushNotificationService");
const { sendOrderTrackingUpdateEmail } = require("../services/orderTrackingEmailService");
const {
  backfillTrackingEventsFromOrder,
  buildHydratedTrackingSteps,
  createTrackingEvent,
  fetchTrackingStepEvents,
  hydrateOrderTracking,
  hydrateOrdersTracking,
  mapTrackingEventToUpdate,
} = require("../services/trackingEventService");

const USA_ADMIN_ROLES = new Set(["gerenteUSA", "adminUSA"]);
const LATAM_LOCKED_STEP_KEYS = new Set(["order-received", "vehicle-search", "booking-and-shipping"]);
const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";
const ORDER_DOCUMENT_TYPES = new Set([
  "FACTURA",
  "BL",
  "CEPD",
  "TITULO",
  "BOOKING",
  "TRACKING",
  "REGISTRO DE IMPORTACION",
  "FOTOS",
  "AES",
  "CONTRATO",
  "SWIFT",
  "SOPORTE_DE_PAGO",
  "PRE_APOSTILLA",
  "OTRO",
]);
const ORDER_DOCUMENT_TYPE_ALIASES = new Map([
  ["SOPORTE DE PAGO", "SOPORTE_DE_PAGO"],
  ["PRE APOSTILLA", "PRE_APOSTILLA"],
  ["PRE-APOSTILLA", "PRE_APOSTILLA"],
  ["REGISTRO_DE_IMPORTACION", "REGISTRO DE IMPORTACION"],
]);
const ORDER_EXPENSE_CONCEPTS = new Set([
  "port-expense",
  "taxes",
  "nationalization",
  "transport",
  "fees",
  "vehicle-payment",
  "other",
]);

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

function normalizeRequesterId(requester) {
  if (!requester || typeof requester !== "object") {
    return String(requester || "").trim();
  }

  return String(requester._id || requester.id || "").trim();
}

function normalizeOrderCreatorId(order) {
  const createdBy = order?.createdBy;

  if (!createdBy) {
    return "";
  }

  if (typeof createdBy === "object") {
    return String(createdBy._id || createdBy.id || "").trim();
  }

  return String(createdBy).trim();
}

function isOrderCreatedByRequester(order, requester) {
  const requesterId = normalizeRequesterId(requester);
  const creatorId = normalizeOrderCreatorId(order);

  return Boolean(requesterId) && Boolean(creatorId) && requesterId === creatorId;
}

function isUsaAdministrativeRole(role) {
  return USA_ADMIN_ROLES.has(String(role || ""));
}

function isGlobalManagerRole(requester) {
  return normalizeRequesterRole(requester) === "manager";
}

function isAnthonyGlobalOwner(requester) {
  return isGlobalManagerRole(requester) && normalizeRequesterEmail(requester) === ANTHONY_GLOBAL_OWNER_EMAIL;
}

function canAccessLatamOrders(requester) {
  const normalizedRole = normalizeRequesterRole(requester);
  return normalizedRole === "admin" || normalizedRole === "manager" || isUsaAdministrativeRole(normalizedRole);
}

function canAccessUsaOrders(requester) {
  return isAnthonyGlobalOwner(requester) || isUsaAdministrativeRole(normalizeRequesterRole(requester));
}

function resolveOrderRegionByRole(role) {
  return isUsaAdministrativeRole(role) ? "usa" : "latam";
}

function canManageDeletionRequests(role) {
  return ["manager", "gerenteUSA"].includes(String(role || ""));
}

function canManageTrackingEventDeletionRequests(requester) {
  return isAnthonyGlobalOwner(requester);
}

function resolveTrackingStepIndex(stepKey) {
  return TRACKING_STATE_TEMPLATES.findIndex((step) => step.key === String(stepKey || "").trim());
}

function canModifyTrackingStep(requester, stepKey) {
  const normalizedStepKey = String(stepKey || "");
  const stepIndex = resolveTrackingStepIndex(normalizedStepKey);

  if (!normalizedStepKey || stepIndex === -1) {
    return false;
  }

  if (isAnthonyGlobalOwner(requester)) {
    return true;
  }

  const requesterRole = normalizeRequesterRole(requester);

  if (isUsaAdministrativeRole(requesterRole)) {
    return stepIndex <= 3;
  }

  if (["admin", "manager"].includes(requesterRole)) {
    return stepIndex >= 3;
  }

  return false;
}

function getCurrentTrackingStepIndex(steps = []) {
  if (!Array.isArray(steps) || !steps.length) {
    return -1;
  }

  const explicitIndex = steps.findIndex((step) => Boolean(step?.inProgress) && !Boolean(step?.confirmed));

  if (explicitIndex >= 0) {
    return explicitIndex;
  }

  const firstPendingIndex = steps.findIndex((step) => !Boolean(step?.confirmed));

  if (firstPendingIndex >= 0) {
    return firstPendingIndex;
  }

  return steps.length - 1;
}

function canTransitionTrackingStep(requester, currentIndex, targetIndex) {
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= TRACKING_STATE_TEMPLATES.length) {
    return false;
  }

  if (isAnthonyGlobalOwner(requester)) {
    return true;
  }

  const requesterRole = normalizeRequesterRole(requester);

  if (isUsaAdministrativeRole(requesterRole)) {
    return currentIndex <= 2 && targetIndex <= 3;
  }

  if (["admin", "manager"].includes(requesterRole)) {
    return currentIndex >= 3 && targetIndex >= 3;
  }

  return false;
}

function canFinalizeTrackingOrder(requester, order, currentIndex, orderRegion = "latam") {
  const normalizedRole = normalizeRequesterRole(requester);
  const normalizedRegion = String(orderRegion || "latam").trim().toLowerCase();

  if (isAnthonyGlobalOwner(requester)) {
    return currentIndex === TRACKING_STATE_TEMPLATES.length - 1 || (normalizedRegion === "usa" && currentIndex === 3);
  }

  if (normalizedRegion === "usa") {
    return isUsaAdministrativeRole(normalizedRole) && currentIndex === 3 && isOrderCreatedByRequester(order, requester);
  }

  return currentIndex === TRACKING_STATE_TEMPLATES.length - 1 && ["admin", "manager"].includes(normalizedRole);
}

function resolveOrderModelForCreate(role) {
  return isUsaAdministrativeRole(role) ? OrderGlobalUS : Order;
}

function resolveClientModelForCreate(role) {
  return isUsaAdministrativeRole(role) ? ClientGlobalUS : Client;
}

async function findOrderForRole(orderId, requester) {
  if (canAccessLatamOrders(requester)) {
    const latamOrder = await Order.findById(orderId);

    if (latamOrder) {
      return { order: latamOrder, orderModel: Order, region: "latam" };
    }
  }

  if (canAccessUsaOrders(requester)) {
    const usaOrder = await OrderGlobalUS.findById(orderId);

    if (usaOrder) {
      return { order: usaOrder, orderModel: OrderGlobalUS, region: "usa" };
    }
  }

  return { order: null, orderModel: null, region: null };
}

async function findOrderForDeletionManagement(orderId, requester) {
  const normalizedRole = normalizeRequesterRole(requester);

  if (normalizedRole === "gerenteUSA") {
    const usaOrder = await OrderGlobalUS.findById(orderId);
    return { order: usaOrder, orderModel: usaOrder ? OrderGlobalUS : null, region: usaOrder ? "usa" : null };
  }

  if (isAnthonyGlobalOwner(requester)) {
    const latamOrder = await Order.findById(orderId);

    if (latamOrder) {
      return { order: latamOrder, orderModel: Order, region: "latam" };
    }

    const usaOrder = await OrderGlobalUS.findById(orderId);
    return { order: usaOrder, orderModel: usaOrder ? OrderGlobalUS : null, region: usaOrder ? "usa" : null };
  }

  if (normalizedRole === "manager") {
    const latamOrder = await Order.findById(orderId);
    return { order: latamOrder, orderModel: latamOrder ? Order : null, region: latamOrder ? "latam" : null };
  }

  const latamOrder = await Order.findById(orderId);
  return { order: latamOrder, orderModel: latamOrder ? Order : null, region: latamOrder ? "latam" : null };
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

function buildTrackingUpdateEntry({
  notes = "",
  media = [],
  clientVisible = false,
  inProgress = false,
  completed = false,
  timestamp = new Date(),
}) {
  const resolvedTimestamp = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
    ? timestamp
    : new Date(timestamp || Date.now());

  return {
    notes: typeof notes === "string" ? notes.trim() : "",
    media: normalizeMedia(media || []),
    clientVisible: Boolean(clientVisible),
    inProgress: completed ? false : Boolean(inProgress),
    completed: Boolean(completed),
    createdAt: resolvedTimestamp,
    updatedAt: resolvedTimestamp,
  };
}

function buildFlattenedTrackingStepMedia(updates = []) {
  return (Array.isArray(updates) ? updates : []).flatMap((update) => normalizeMedia(update?.media || []));
}

function syncTrackingStepDerivedFields(step) {
  if (!step) {
    return step;
  }

  const latestUpdate = getLatestTrackingStepUpdate(step);
  const lastCompletedUpdate = [...(Array.isArray(step.updates) ? step.updates : [])]
    .reverse()
    .find((item) => item?.completed) || null;

  step.notes = latestUpdate?.notes || "";
  step.media = buildFlattenedTrackingStepMedia(step.updates || []);
  step.updatedAt = latestUpdate?.updatedAt || latestUpdate?.createdAt || step.updatedAt || new Date();
  step.clientVisible = Array.isArray(step.updates) && step.updates.some((item) => item?.clientVisible);
  step.confirmedAt = step.confirmed
    ? step.confirmedAt || lastCompletedUpdate?.updatedAt || lastCompletedUpdate?.createdAt || step.updatedAt || new Date()
    : null;

  return step;
}

function syncTrackingStepFlagsFromLatestUpdate(step) {
  if (!step) {
    return step;
  }

  const latestUpdate = getLatestTrackingStepUpdate(step);
  const hasCompletedUpdate = Array.isArray(step.updates) && step.updates.some((item) => item?.completed);

  step.confirmed = Boolean(step.confirmed || hasCompletedUpdate || latestUpdate?.completed);
  step.inProgress = step.confirmed ? false : Boolean(latestUpdate?.inProgress);

  return syncTrackingStepDerivedFields(step);
}

async function persistTrackingOrderState(orderResult, order) {
  const normalizedTrackingSteps = normalizeTrackingStates(order.trackingSteps || []);
  const nextStatus = normalizedTrackingSteps.every((state) => state.confirmed) ? "completed" : "active";
  const trackingEventCollectionEnabled = Boolean(order.trackingEventCollectionEnabled);

  order.set("trackingSteps", normalizedTrackingSteps);
  order.set("status", nextStatus);
  order.set("trackingEventCollectionEnabled", trackingEventCollectionEnabled);

  await order.validate();

  await orderResult.orderModel.findByIdAndUpdate(order._id, {
    $set: {
      trackingSteps: normalizedTrackingSteps,
      status: nextStatus,
      trackingEventCollectionEnabled,
    },
  });

  return orderResult.orderModel.findById(order._id)
    .populate("client", "name email phone")
    .populate("createdBy", "name email role");
}
function buildInitialTrackingSteps(timestamp = new Date()) {
  const resolvedTimestamp = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
    ? timestamp
    : new Date(timestamp || Date.now());
  const trackingSteps = normalizeTrackingStates([]);

  return trackingSteps.map((step, index) => {
    if (index !== 0) {
      return {
        ...step,
        inProgress: false,
        confirmed: false,
        clientVisible: false,
        notes: "",
        media: [],
        updates: [],
        updatedAt: null,
        confirmedAt: null,
      };
    }

    const initialUpdate = buildTrackingUpdateEntry({
      notes: "Orden creada.",
      media: [],
      clientVisible: false,
      inProgress: true,
      completed: false,
      timestamp: resolvedTimestamp,
    });

    return {
      ...step,
      inProgress: true,
      confirmed: false,
      clientVisible: false,
      notes: initialUpdate.notes,
      media: [],
      updates: [initialUpdate],
      updatedAt: resolvedTimestamp,
      confirmedAt: null,
    };
  });
}

function ensureTrackingStepLifecycleUpdate(step, {
  notes = "",
  clientVisible = false,
  inProgress = false,
  completed = false,
  timestamp = new Date(),
} = {}) {
  if (!step) {
    return null;
  }

  if (!Array.isArray(step.updates)) {
    step.updates = [];
  }

  const resolvedTimestamp = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
    ? timestamp
    : new Date(timestamp || Date.now());
  const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
  const latestUpdate = getLatestTrackingStepUpdate(step);
  const latestNotes = String(latestUpdate?.notes || "").trim();
  const latestMediaCount = Array.isArray(latestUpdate?.media) ? latestUpdate.media.length : 0;
  const latestMatchesLifecycle = Boolean(latestUpdate)
    && Boolean(latestUpdate.completed) === Boolean(completed)
    && Boolean(latestUpdate.inProgress) === Boolean(completed ? false : inProgress)
    && Boolean(latestUpdate.clientVisible) === Boolean(clientVisible)
    && latestNotes === normalizedNotes
    && latestMediaCount === 0;

  if (latestMatchesLifecycle) {
    latestUpdate.createdAt = latestUpdate.createdAt || resolvedTimestamp;
    latestUpdate.updatedAt = latestUpdate.updatedAt || resolvedTimestamp;
    return latestUpdate;
  }

  const lifecycleUpdate = buildTrackingUpdateEntry({
    notes: normalizedNotes,
    media: [],
    clientVisible,
    inProgress,
    completed,
    timestamp: resolvedTimestamp,
  });

  step.updates.push(lifecycleUpdate);
  return lifecycleUpdate;
}

function buildSyntheticTrackingVisibilityUpdate(step, {
  clientVisible = false,
  inProgress = false,
  completed = false,
  timestamp = new Date(),
} = {}) {
  if (!step) {
    return null;
  }

  const fallbackNotes = String(step.notes || "").trim()
    || (completed
      ? "Etapa completada."
      : inProgress
        ? "Estado en curso."
        : step.key === "order-received"
          ? "Orden creada."
          : "Actualizacion interna.");

  return buildTrackingUpdateEntry({
    notes: fallbackNotes,
    media: normalizeMedia(step.media || []),
    clientVisible,
    inProgress,
    completed,
    timestamp,
  });
}

function getLatestConfirmedVisibleStep(steps = [], excludedStepKey = "") {
  return (steps || [])
    .map((step) => buildTrackingStepSnapshot(step, getLatestTrackingStepUpdate(step, (update) => update.completed && update.clientVisible)))
    .filter((step) => step?.confirmed && step?.clientVisible && step.key !== excludedStepKey)
    .sort((left, right) => new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime())
    .slice(-1)[0] || null;
}

async function notifyPublishedTrackingStep(order, previousStep, publishedStep) {
  if (!publishedStep?.clientVisible) {
    return {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };
  }

  const clientPushResult = await sendTrackingUpdateNotifications(order, publishedStep, previousStep).catch(() => ({ sent: 0, skipped: 0 }));

  await sendTrackingUpdateEmails(order, previousStep, publishedStep).catch(() => null);
  await sendTrackingUpdateAdminNotifications(order, publishedStep).catch(() => null);
  await sendTrackingUpdateAdminEmails(order, previousStep, publishedStep).catch(() => null);

  return {
    clientPushSent: Number(clientPushResult?.sent || 0),
    clientPushSkipped: Number(clientPushResult?.skipped || 0),
  };
}

function buildPublishedOrderDocumentStep(document) {
  if (!document?.url) {
    return null;
  }

  const documentName = String(document.name || document.caption || "Documento").trim() || "Documento";
  const documentNote = String(document.note || "").trim();
  const documentTimestamp = document.updatedAt || document.createdAt || new Date();

  return {
    key: "order-documents",
    label: "Nuevo documento disponible",
    notes: documentNote || `Se compartio ${documentName}.`,
    media: [document],
    clientVisible: true,
    inProgress: false,
    confirmed: false,
    updatedAt: documentTimestamp,
    confirmedAt: null,
  };
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
      documentId: item.documentId ? String(item.documentId).trim() : undefined,
      type: item.type,
      category: item.category ? String(item.category).trim() : undefined,
      url: String(item.url).trim(),
      name: item.name ? String(item.name).trim() : undefined,
      caption: item.caption ? String(item.caption).trim() : undefined,
      documentType: item.documentType ? String(item.documentType).trim().toUpperCase() : undefined,
      note: item.note ? String(item.note).trim() : "",
      clientVisible: parseBooleanValue(item.clientVisible, true),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null,
    }));
}

function normalizeOrderDocumentType(value, fallback = "OTRO") {
  const normalizedValue = String(value || "").trim().toUpperCase();

  if (ORDER_DOCUMENT_TYPES.has(normalizedValue)) {
    return normalizedValue;
  }

  const aliasValue = ORDER_DOCUMENT_TYPE_ALIASES.get(normalizedValue);

  if (aliasValue && ORDER_DOCUMENT_TYPES.has(aliasValue)) {
    return aliasValue;
  }

  return fallback;
}

function normalizeOrderDocumentNote(value) {
  return String(value || "").trim();
}

function isOrderDocumentMediaItem(item) {
  return Boolean(item?.url) && (String(item?.category || "") === "document" || String(item?.type || "") === "document");
}

function getOrderDocumentMediaIndex(media = [], documentId = "") {
  const normalizedDocumentId = String(documentId || "").trim();

  if (!normalizedDocumentId) {
    return -1;
  }

  return (Array.isArray(media) ? media : []).findIndex((item) => String(item?.documentId || "").trim() === normalizedDocumentId);
}

function buildOrderDocumentMediaItems(uploadedMedia = [], options = {}) {
  const timestamp = options.timestamp || new Date();
  const documentType = normalizeOrderDocumentType(options.documentType);
  const note = normalizeOrderDocumentNote(options.note);
  const clientVisible = parseBooleanValue(options.clientVisible, false);

  return normalizeMedia(uploadedMedia).map((item) => ({
    ...item,
    documentId: item.documentId || randomUUID(),
    type: item.type === "image" || item.type === "video" ? item.type : "document",
    category: "document",
    documentType,
    note,
    clientVisible,
    createdAt: item.createdAt || timestamp,
    updatedAt: timestamp,
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

function buildOptimizedCloudinaryUrl(result, file) {
  const secureUrl = String(result?.secure_url || "").trim();

  if (!secureUrl) {
    return "";
  }

  if (inferFileMediaType(file, result) !== "image") {
    return secureUrl;
  }

  return secureUrl.includes("/upload/")
    ? secureUrl.replace("/upload/", "/upload/f_auto,q_auto/")
    : secureUrl;
}

function parseExpenseValue(value) {
  const parsedValue = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error("value must be a valid positive number");
  }

  return parsedValue;
}

function validateAccountingEvidenceFile(file) {
  if (!file) {
    return;
  }

  const mimeType = String(file.mimetype || "").trim().toLowerCase();

  if (mimeType.startsWith("image/") || mimeType === "application/pdf") {
    return;
  }

  throw new Error("evidence must be an image or PDF file");
}

async function uploadAccountingEvidenceToCloudinary(file) {
  if (!file) {
    return null;
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  const result = await uploadBufferToCloudinary(
    file,
    process.env.CLOUDINARY_ACCOUNTING_FOLDER || "global-app/accounting"
  );
  const timestamp = new Date();
  const type = inferFileMediaType(file, result);

  return {
    documentId: randomUUID(),
    type,
    category: type === "image" ? "photo-single" : "document",
    url: buildOptimizedCloudinaryUrl(result, file),
    name: file.originalname,
    caption: file.originalname ? String(file.originalname).replace(/\.[^.]+$/, "") : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function serializeOrder(order, orderRegion = "latam") {
  return hydrateOrderTracking(order, orderRegion, {
    preferCollectionOnly: Boolean(order?.trackingEventCollectionEnabled),
  });
}

async function ensureTrackingEventCollectionReady(order, orderModel, orderRegion) {
  if (!order?._id || !orderModel) {
    return order;
  }

  (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));

  const wasCollectionEnabled = Boolean(order.trackingEventCollectionEnabled);

  await backfillTrackingEventsFromOrder(order, orderRegion);

  if (!wasCollectionEnabled && order.trackingEventCollectionEnabled) {
    await orderModel.findByIdAndUpdate(order._id, {
      $set: {
        trackingEventCollectionEnabled: true,
      },
    });
  }

  return order;
}

async function ensureTrackingEventCollectionsReady(orderEntries = []) {
  await Promise.all(
    (orderEntries || []).map((entry) =>
      ensureTrackingEventCollectionReady(entry?.order, entry?.orderModel, entry?.orderRegion)
    )
  );

  return orderEntries;
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

function resolveTrackingEventByReference(stepEvents = [], { eventId = "", updateIndex = -1 } = {}) {
  const normalizedEventId = String(eventId || "").trim();

  if (normalizedEventId) {
    return (stepEvents || []).find((event) => String(event?._id || event?.id || "") === normalizedEventId) || null;
  }

  if (!Array.isArray(stepEvents) || updateIndex < 0) {
    return null;
  }

  return stepEvents[updateIndex] || null;
}

function hydrateTrackingStepMediaFromFlattenedState(step) {
  if (!step || !Array.isArray(step.updates) || !step.updates.length || !Array.isArray(step.media) || !step.media.length) {
    return step;
  }

  step.updates.forEach((update, updateIndex) => {
    const normalizedUpdateMedia = normalizeMedia(update?.media || []);

    if (normalizedUpdateMedia.length) {
      update.media = normalizedUpdateMedia;
      return;
    }

    const fallbackMedia = normalizeMedia(
      step.media.filter((item) => {
        const mediaUpdateIndex = parseTrackingUpdateIndex(item?.updateIndex);

        if (mediaUpdateIndex >= 0) {
          return mediaUpdateIndex === updateIndex;
        }

        return step.updates.length === 1 && updateIndex === 0;
      })
    );

    if (fallbackMedia.length) {
      update.media = fallbackMedia;
    }
  });

  return step;
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

function hasTrackingUpdateChanges({ title = "", location = "", notes = "", media = [], requestedConfirmed = false, requestedInProgress = false, step }) {
  if (String(title || "").trim()) {
    return true;
  }

  if (String(location || "").trim()) {
    return true;
  }

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

function arePreviousTrackingStepsConfirmed(steps = [], stepIndex = -1) {
  if (!Array.isArray(steps) || stepIndex <= 0) {
    return true;
  }

  return steps.slice(0, stepIndex).every((item) => Boolean(item?.confirmed));
}

function findNextIncompleteTrackingStepIndex(steps = [], fromIndex = -1) {
  if (!Array.isArray(steps) || !steps.length) {
    return -1;
  }

  for (let index = Math.max(0, fromIndex + 1); index < steps.length; index += 1) {
    if (!steps[index]?.confirmed) {
      return index;
    }
  }

  return -1;
}

function syncTrackingStepProgression(steps = [], preferredActiveIndex = -1) {
  if (!Array.isArray(steps) || !steps.length) {
    return steps;
  }

  let resolvedActiveIndex = preferredActiveIndex;

  if (
    resolvedActiveIndex < 0
    || steps[resolvedActiveIndex]?.confirmed
    || !arePreviousTrackingStepsConfirmed(steps, resolvedActiveIndex)
  ) {
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

async function trackingExistsInOtherOrder(orderId, trackingNumber) {
  const normalizedTrackingNumber = normalizeTrackingNumber(trackingNumber);

  if (!normalizedTrackingNumber) {
    return false;
  }

  const normalizedOrderId = String(orderId || "").trim();
  const trackingQuery = {
    trackingNumber: { $regex: `^${escapeRegex(normalizedTrackingNumber)}$`, $options: "i" },
  };
  const [latamOrder, usaOrder] = await Promise.all([
    Order.findOne(trackingQuery).select("_id trackingNumber"),
    OrderGlobalUS.findOne(trackingQuery).select("_id trackingNumber"),
  ]);

  return [latamOrder, usaOrder].some((order) => order && String(order._id || "") !== normalizedOrderId);
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
    const notes = normalizeOptionalString(req.body.notes);
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
      !["Puerto Santa Marta", "Puerto Cartagena", "Puerto Barranquilla", "Puerto Miami"].includes(String(vehicle.destination).trim())
    ) {
      return res.status(400).json({ message: "destination must be Puerto Santa Marta, Puerto Cartagena, Puerto Barranquilla or Puerto Miami" });
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
    const initialTrackingTimestamp = purchaseDate || new Date();
    const trackingSteps = buildInitialTrackingSteps(initialTrackingTimestamp);

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
      notes,
      media: normalizeMedia(uploadedMedia),
      trackingSteps,
    });

    if (orderRegion === "latam") {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    const populatedOrder = await OrderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(201).json({
      message: "Order created successfully",
      order: await serializeOrder(populatedOrder, orderRegion),
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
    const [latamOrders, usaOrders] = await Promise.all([
      canAccessLatamOrders(req.user)
        ? Order.find().populate("client", "name email phone").populate("createdBy", "name email role")
        : Promise.resolve([]),
      canAccessUsaOrders(req.user)
        ? OrderGlobalUS.find().populate("client", "name email phone").populate("createdBy", "name email role")
        : Promise.resolve([]),
    ]);

    const orderEntries = latamOrders
      .map((order) => ({ order, orderModel: Order, orderRegion: "latam" }))
      .concat(usaOrders.map((order) => ({ order, orderModel: OrderGlobalUS, orderRegion: "usa" })));

    await ensureTrackingEventCollectionsReady(orderEntries);

    const hydratedOrders = await hydrateOrdersTracking(orderEntries);
    hydratedOrders.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());

    return res.status(200).json({
      orders: hydratedOrders,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching orders" });
  }
}

async function listOrderDeletionRequests(req, res) {
  try {
    const requesterRole = String(req.user?.role || "");

    if (!canManageDeletionRequests(requesterRole)) {
      return res.status(403).json({ message: "No tienes permisos para ver solicitudes de eliminacion" });
    }

    const [latamPendingOrders, usaPendingOrders] = await Promise.all([
      requesterRole === "manager"
        ? Order.find({ "deletionRequest.status": "pending" })
            .populate("client", "name email phone")
            .populate("createdBy", "name email role")
            .populate("deletionRequest.requestedBy", "name email role")
            .sort({ "deletionRequest.requestedAt": -1, createdAt: -1 })
        : Promise.resolve([]),
      (isAnthonyGlobalOwner(req.user) || requesterRole === "gerenteUSA")
        ? OrderGlobalUS.find({ "deletionRequest.status": "pending" })
            .populate("client", "name email phone")
            .populate("createdBy", "name email role")
            .populate("deletionRequest.requestedBy", "name email role")
            .sort({ "deletionRequest.requestedAt": -1, createdAt: -1 })
        : Promise.resolve([]),
    ]);

    const orderEntries = latamPendingOrders
      .map((order) => ({ order, orderModel: Order, orderRegion: "latam" }))
      .concat(usaPendingOrders.map((order) => ({ order, orderModel: OrderGlobalUS, orderRegion: "usa" })));

    const pendingOrders = orderEntries
      .map((entry) => {
        const plainOrder = entry.order?.toObject ? entry.order.toObject() : { ...(entry.order || {}) };

        return {
          ...plainOrder,
          orderRegion: entry.orderRegion,
        };
      })
      .sort((left, right) => {
        const leftTime = new Date(left?.deletionRequest?.requestedAt || left?.createdAt || 0).getTime();
        const rightTime = new Date(right?.deletionRequest?.requestedAt || right?.createdAt || 0).getTime();
        return rightTime - leftTime;
      });

    let pendingTrackingEventRequests = [];

    if (canManageTrackingEventDeletionRequests(req.user)) {
      const trackingEventRequests = await OrderTrackingEvent.find({ "deletionRequest.status": "pending" })
        .populate("deletionRequest.requestedBy", "name email role")
        .populate("deletionRequest.reviewedBy", "name email role")
        .sort({ "deletionRequest.requestedAt": -1, updatedAt: -1, createdAt: -1 })
        .lean();

      const latamOrderIds = [...new Set(
        trackingEventRequests
          .filter((event) => event?.orderRegion === "latam" && event?.orderId)
          .map((event) => String(event.orderId))
      )];
      const usaOrderIds = [...new Set(
        trackingEventRequests
          .filter((event) => event?.orderRegion === "usa" && event?.orderId)
          .map((event) => String(event.orderId))
      )];

      const [latamOrders, usaOrders] = await Promise.all([
        latamOrderIds.length
          ? Order.find({ _id: { $in: latamOrderIds } })
              .populate("client", "name email phone")
              .lean()
          : Promise.resolve([]),
        usaOrderIds.length
          ? OrderGlobalUS.find({ _id: { $in: usaOrderIds } })
              .populate("client", "name email phone")
              .lean()
          : Promise.resolve([]),
      ]);

      const orderLookup = new Map(
        latamOrders.concat(usaOrders).map((order) => [String(order._id), order])
      );

      pendingTrackingEventRequests = trackingEventRequests
        .map((event) => {
          const relatedOrder = orderLookup.get(String(event.orderId || "")) || null;

          if (!relatedOrder) {
            return null;
          }

          return {
            type: "tracking-event",
            eventId: String(event._id || ""),
            orderId: String(relatedOrder._id || ""),
            orderRegion: event.orderRegion,
            trackingNumber: relatedOrder.trackingNumber || "",
            status: relatedOrder.status || "active",
            createdAt: relatedOrder.createdAt || null,
            vehicle: relatedOrder.vehicle || {},
            client: relatedOrder.client || null,
            stepKey: event.stepKey || "",
            stateCode: event.stateCode || "-",
            stateLabel: event.stateLabel || "Estado",
            eventTitle: event.title || "Evento sin título",
            eventLocation: event.location || "",
            eventNotes: event.notes || "",
            eventCreatedAt: event.createdAt || null,
            eventUpdatedAt: event.updatedAt || event.createdAt || null,
            deletionRequest: event.deletionRequest || { status: "none" },
          };
        })
        .filter(Boolean);
    }

    return res.status(200).json({
      orders: pendingOrders,
      trackingEventRequests: pendingTrackingEventRequests,
    });
  } catch (error) {
    console.error("Error fetching deletion requests", error);
    return res.status(500).json({ message: "Error fetching deletion requests" });
  }
}

async function getOrder(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);

    if (!orderResult.order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = await orderResult.orderModel.findById(req.params.orderId)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    await ensureTrackingEventCollectionReady(order, orderResult.orderModel, orderResult.region);

    return res.status(200).json({ order: await serializeOrder(order, orderResult.region) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching order" });
  }
}

async function updateOrder(req, res) {
  try {
    const { vehicle, purchaseDate, expectedArrivalDate, media, notes, status } = req.body;
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const sourceVehicle = vehicle && typeof vehicle === "object" ? vehicle : {};
    const nextBrand = normalizeOptionalString(req.body.brand ?? sourceVehicle.brand);
    const nextModel = normalizeOptionalString(req.body.model ?? sourceVehicle.model);
    const nextVersion = normalizeOptionalString(req.body.version ?? sourceVehicle.version);
    const nextVin = normalizeOptionalString(req.body.vin ?? sourceVehicle.vin);
    const nextDestination = normalizeOptionalString(req.body.destination ?? sourceVehicle.destination);
    const fallbackColor = normalizeOptionalString(req.body.color ?? sourceVehicle.color);
    const nextExteriorColor = normalizeOptionalString(req.body.exteriorColor ?? sourceVehicle.exteriorColor) || fallbackColor;
    const nextInteriorColor = normalizeOptionalString(req.body.interiorColor ?? sourceVehicle.interiorColor) || fallbackColor;
    const nextInternalIdentifier = normalizeOptionalString(
      req.body.internalIdentifier ?? req.body.description ?? sourceVehicle.internalIdentifier ?? sourceVehicle.description
    );
    const trackingNumberProvided = Object.prototype.hasOwnProperty.call(req.body, "trackingNumber");
    const nextTrackingNumber = trackingNumberProvided
      ? normalizeTrackingNumber(req.body.trackingNumber)
      : normalizeTrackingNumber(order.trackingNumber);
    const clientId = normalizeOptionalString(req.body.clientId);
    const hasYearValue = Object.prototype.hasOwnProperty.call(req.body, "year") || Object.prototype.hasOwnProperty.call(sourceVehicle, "year");
    const parsedYear = hasYearValue
      ? Number.parseInt(String(req.body.year ?? sourceVehicle.year ?? "").trim(), 10)
      : undefined;

    if (hasYearValue && Number.isNaN(parsedYear)) {
      return res.status(400).json({ message: "year must be a valid number" });
    }

    if (trackingNumberProvided && !nextTrackingNumber) {
      return res.status(400).json({ message: "trackingNumber is required" });
    }

    if (
      nextDestination &&
      orderResult.region === "latam" &&
      !["Puerto Santa Marta", "Puerto Cartagena", "Puerto Barranquilla", "Puerto Miami"].includes(String(nextDestination).trim())
    ) {
      return res.status(400).json({ message: "destination must be Puerto Santa Marta, Puerto Cartagena, Puerto Barranquilla or Puerto Miami" });
    }

    if (trackingNumberProvided && normalizeTrackingNumber(order.trackingNumber) !== nextTrackingNumber) {
      if (await trackingExistsInOtherOrder(order._id, nextTrackingNumber)) {
        return res.status(409).json({ message: "Tracking number already exists" });
      }

      order.trackingNumber = nextTrackingNumber;
    }

    if (clientId) {
      const ClientModel = orderResult.region === "usa" ? ClientGlobalUS : Client;
      const client = await ClientModel.findById(clientId);

      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }

      order.client = client._id;
    }

    const normalizedVehicle = {
      ...(nextBrand !== undefined ? { brand: nextBrand } : {}),
      ...(nextModel !== undefined ? { model: nextModel } : {}),
      ...(nextVersion !== undefined ? { version: nextVersion } : {}),
      ...(hasYearValue ? { year: parsedYear } : {}),
      ...(nextVin !== undefined ? { vin: nextVin } : {}),
      ...(nextDestination !== undefined ? { destination: nextDestination } : {}),
      ...(nextExteriorColor !== undefined ? { exteriorColor: nextExteriorColor } : {}),
      ...(nextInteriorColor !== undefined ? { interiorColor: nextInteriorColor } : {}),
      ...((nextExteriorColor !== undefined || nextInteriorColor !== undefined || fallbackColor !== undefined)
        ? { color: nextExteriorColor || nextInteriorColor || fallbackColor }
        : {}),
      ...(nextInternalIdentifier !== undefined ? { internalIdentifier: nextInternalIdentifier } : {}),
    };

    if (Object.keys(normalizedVehicle).length) {
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
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating order" });
  }
}

async function updateOrderVehiclePricing(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order || orderResult.region !== "latam") {
      return res.status(404).json({ message: "Order not found" });
    }

    const parsePrice = (value, fieldName) => {
      if (value === "" || value === null || value === undefined) {
        return null;
      }

      const parsedValue = Number.parseFloat(String(value).replace(/,/g, "").trim());

      if (!Number.isFinite(parsedValue) || parsedValue < 0) {
        throw new Error(`${fieldName} must be a valid positive number`);
      }

      return parsedValue;
    };

    let purchasePrice = null;
    let salePrice = null;
    const plate = String(req.body.plate || "").trim().toUpperCase();

    try {
      purchasePrice = parsePrice(req.body.purchasePrice, "purchasePrice");
      salePrice = parsePrice(req.body.salePrice, "salePrice");
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    order.vehicle = {
      ...(order.vehicle?.toObject ? order.vehicle.toObject() : order.vehicle || {}),
      plate,
      purchasePrice,
      salePrice,
    };

    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Vehicle pricing updated successfully",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating vehicle pricing" });
  }
}

async function addOrderAccountingExpense(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order || orderResult.region !== "latam") {
      return res.status(404).json({ message: "Order not found" });
    }

    const concept = String(req.body.concept || "").trim();
    const description = String(req.body.description || "").trim();

    if (!ORDER_EXPENSE_CONCEPTS.has(concept)) {
      return res.status(400).json({ message: "concept is not valid" });
    }

    let value = 0;

    try {
      value = parseExpenseValue(req.body.value);
      validateAccountingEvidenceFile(req.file);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message });
    }

    const evidence = await uploadAccountingEvidenceToCloudinary(req.file);
    const timestamp = new Date();
    const normalizedExpenses = Array.isArray(order.expenses) ? [...order.expenses] : [];

    normalizedExpenses.push({
      expenseId: randomUUID(),
      concept,
      description,
      value,
      evidence,
      createdBy: req.user?._id || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    order.expenses = normalizedExpenses;
    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(201).json({
      message: "Accounting expense created successfully",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message || "Error creating accounting expense" });
  }
}

async function deleteOrderAccountingExpense(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order || orderResult.region !== "latam") {
      return res.status(404).json({ message: "Order not found" });
    }

    const expenseId = String(req.params.expenseId || "").trim();
    const expenses = Array.isArray(order.expenses) ? [...order.expenses] : [];
    const nextExpenses = expenses.filter((expense) => String(expense?.expenseId || "") !== expenseId);

    if (nextExpenses.length === expenses.length) {
      return res.status(404).json({ message: "Accounting expense not found" });
    }

    order.expenses = nextExpenses;
    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Accounting expense deleted successfully",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting accounting expense" });
  }
}

async function uploadOrderDocuments(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const uploadedFiles = req.files || [];

    if (!uploadedFiles.length) {
      return res.status(400).json({ message: "Debes subir al menos un archivo" });
    }

    const uploadedMedia = await uploadFilesToCloudinary(uploadedFiles);
    const documents = buildOrderDocumentMediaItems(uploadedMedia, {
      documentType: req.body.documentType,
      note: req.body.note,
      clientVisible: req.body.clientVisible,
      timestamp: new Date(),
    });

    order.media = normalizeMedia([...(Array.isArray(order.media) ? order.media : []), ...documents]);
    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Documentos cargados correctamente",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message || "Error uploading order documents" });
  }
}

async function toggleOrderDocumentVisibility(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const normalizedMedia = normalizeMedia(order.media || []);
    const documentIndex = getOrderDocumentMediaIndex(normalizedMedia, req.params.documentId);

    if (documentIndex === -1 || !isOrderDocumentMediaItem(normalizedMedia[documentIndex])) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    const previousClientVisible = Boolean(normalizedMedia[documentIndex]?.clientVisible);

    normalizedMedia[documentIndex] = {
      ...normalizedMedia[documentIndex],
      clientVisible: parseBooleanValue(req.body.clientVisible, false),
      updatedAt: new Date(),
    };

    order.media = normalizedMedia;
    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    const updatedDocument = normalizeMedia(updatedOrder?.media || []).find(
      (item) => String(item?.documentId || "").trim() === String(req.params.documentId || "").trim()
    ) || null;
    const requestedClientVisible = Boolean(updatedDocument?.clientVisible);
    let notificationSummary = {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };

    if (requestedClientVisible && !previousClientVisible && updatedDocument) {
      notificationSummary = await notifyPublishedTrackingStep(
        updatedOrder,
        null,
        buildPublishedOrderDocumentStep(updatedDocument)
      );
    }

    return res.status(200).json({
      message: "Visibilidad del documento actualizada",
      notificationSummary,
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating order document visibility" });
  }
}

async function deleteOrderDocument(req, res) {
  try {
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const normalizedMedia = normalizeMedia(order.media || []);
    const documentIndex = getOrderDocumentMediaIndex(normalizedMedia, req.params.documentId);

    if (documentIndex === -1 || !isOrderDocumentMediaItem(normalizedMedia[documentIndex])) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    normalizedMedia.splice(documentIndex, 1);
    order.media = normalizedMedia;
    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Documento eliminado correctamente",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting order document" });
  }
}

async function requestOrderDeletion(req, res) {
  try {
    const requesterRole = String(req.user?.role || "");
    const orderResult = await findOrderForRole(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (canManageDeletionRequests(requesterRole)) {
      await Promise.all([
        OrderTrackingEvent.deleteMany({ orderId: order._id, orderRegion: orderResult.region }),
        orderResult.region === "latam" ? Maintenance.deleteOne({ order: order._id }) : Promise.resolve(),
      ]);

      await order.deleteOne();

      return res.status(200).json({
        message: "Pedido eliminado correctamente",
        orderId: String(req.params.orderId || ""),
      });
    }

    const reason = String(req.body.reason || "").trim();

    if (!reason) {
      return res.status(400).json({ message: "Debes indicar el motivo de la solicitud" });
    }

    if (String(order.deletionRequest?.status || "none") === "pending") {
      return res.status(400).json({ message: "Este pedido ya tiene una solicitud de eliminacion pendiente" });
    }

    order.deletionRequest = {
      status: "pending",
      requestedBy: req.user?._id || null,
      requestedByRole: String(req.user?.role || "").trim(),
      requestedAt: new Date(),
      reason,
      reviewedBy: null,
      reviewedByRole: "",
      reviewedAt: null,
      rejectionReason: "",
    };

    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role")
      .populate("deletionRequest.requestedBy", "name email role");

    return res.status(200).json({
      message: "Solicitud de eliminacion enviada correctamente",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error requesting order deletion" });
  }
}

async function reviewOrderDeletionRequest(req, res) {
  try {
    const requesterRole = String(req.user?.role || "");

    if (!canManageDeletionRequests(requesterRole)) {
      return res.status(403).json({ message: "No tienes permisos para revisar solicitudes de eliminacion" });
    }

    const action = String(req.body.action || "").trim().toLowerCase();
    const rejectionReason = String(req.body.rejectionReason || "").trim();
    const orderResult = await findOrderForDeletionManagement(req.params.orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.deletionRequest?.status || "none") !== "pending") {
      return res.status(400).json({ message: "Este pedido no tiene una solicitud pendiente" });
    }

    if (action === "approve") {
      await Promise.all([
        OrderTrackingEvent.deleteMany({ orderId: order._id, orderRegion: orderResult.region }),
        orderResult.region === "latam" ? Maintenance.deleteOne({ order: order._id }) : Promise.resolve(),
      ]);

      await order.deleteOne();

      return res.status(200).json({
        message: "Pedido eliminado correctamente",
        orderId: String(req.params.orderId || ""),
      });
    }

    if (action !== "reject") {
      return res.status(400).json({ message: "Accion no valida" });
    }

    order.deletionRequest = {
      ...order.deletionRequest?.toObject?.(),
      status: "rejected",
      reviewedBy: req.user?._id || null,
      reviewedByRole: requesterRole,
      reviewedAt: new Date(),
      rejectionReason,
    };

    await order.save();

    const updatedOrder = await orderResult.orderModel.findById(order._id)
      .populate("client", "name email phone")
      .populate("createdBy", "name email role")
      .populate("deletionRequest.requestedBy", "name email role")
      .populate("deletionRequest.reviewedBy", "name email role");

    return res.status(200).json({
      message: "Solicitud rechazada",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error reviewing deletion request" });
  }
}

async function updateTrackingState(req, res) {
  try {
    const { orderId, stepKey } = req.params;
    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));
    await backfillTrackingEventsFromOrder(order, orderResult.region);
    order.trackingEventCollectionEnabled = true;
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });
    order.trackingSteps = (order.trackingSteps || []).map((trackingStep) => syncTrackingStepFlagsFromLatestUpdate(trackingStep));

    const stepIndex = order.trackingSteps.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) {
      return res.status(404).json({ message: "Tracking state not found" });
    }

    const step = order.trackingSteps[stepIndex];
    const operation = String(req.body.operation || "add-update").trim().toLowerCase();
    const existingMedia = parseExistingMediaPayload(req.body.existingMedia);
    const uploadedFiles = req.files || [];
    const externalVideoMedia = parseTrackingVideoLinks(req.body.videoLinks);
    const requestedTitle = String(req.body.title || "").trim();
    const requestedLocation = String(req.body.location || "").trim();
    const requestedNotes = String(req.body.notes || "").trim();
    const requestedConfirmed = parseBooleanValue(req.body.confirmed, step.confirmed);
    const requestedInProgress = requestedConfirmed ? false : parseBooleanValue(req.body.inProgress, step.inProgress);
    const requestedClientVisible = parseBooleanValue(req.body.clientVisible, false);
    const requestedVisibilityOnly = parseBooleanValue(req.body.visibilityOnly, operation === "toggle-update-visibility");
    const requestedMediaVisibilityOnly = parseBooleanValue(req.body.mediaVisibilityOnly, false);
    const forceCreateUpdate = !requestedVisibilityOnly && parseBooleanValue(req.body.forceCreateUpdate, false);
    const requestedEventId = String(req.body.eventId || "").trim();
    const requestedUpdateIndex = parseTrackingUpdateIndex(req.body.updateIndex);
    const requestedMediaIndex = parseTrackingUpdateIndex(req.body.mediaIndex);

    if (!canModifyTrackingStep(req.user, stepKey)) {
      return res.status(403).json({ message: "No tienes permisos para modificar este estado" });
    }

    if (requestedConfirmed && !arePreviousTrackingStepsConfirmed(order.trackingSteps, stepIndex)) {
      return res.status(409).json({ message: "No puedes completar este estado hasta que el anterior este completado." });
    }

    if (requestedInProgress && !arePreviousTrackingStepsConfirmed(order.trackingSteps, stepIndex)) {
      return res.status(409).json({ message: "No puedes poner este estado en curso hasta completar los estados anteriores." });
    }

    hydrateTrackingStepMediaFromFlattenedState(step);

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
        title: requestedTitle,
        location: requestedLocation,
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
    let clientPublishedStep = null;
    let visibilityPublicationEvent = null;
    let visibilityPreviouslyVisible = false;
    if (operation === "toggle-update-visibility" || requestedVisibilityOnly || requestedMediaVisibilityOnly) {
      if (!requestedEventId) {
        return res.status(400).json({ message: "Event ID is required" });
      }

      const updatedEvent = await OrderTrackingEvent.findOne({
        _id: requestedEventId,
        orderId: order._id,
        orderRegion: orderResult.region,
        stepKey,
      });

      if (!updatedEvent) {
        return res.status(404).json({ message: "Subestado no encontrado" });
      }

      visibilityPreviouslyVisible = Boolean(updatedEvent.clientVisible);
      updatedEvent.clientVisible = requestedClientVisible;
      updatedEvent.updatedAt = new Date();
      await updatedEvent.save();
      visibilityPublicationEvent = updatedEvent;
    } else if (forceCreateUpdate || hasTrackingUpdateChanges({
      notes: requestedNotes,
      media: appendedMedia,
      requestedConfirmed,
      requestedInProgress,
      step,
    })) {
      const now = new Date();
      const newUpdate = {
      title: requestedTitle,
      location: requestedLocation,
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

      await createTrackingEvent({
        orderId: order._id,
        orderRegion: orderResult.region,
        stepKey,
          title: requestedTitle,
          location: requestedLocation,
        notes: requestedNotes,
        media: appendedMedia,
        clientVisible: updateShouldBeClientVisible,
        inProgress: requestedConfirmed ? false : requestedInProgress,
        completed: requestedConfirmed,
        timestamp: new Date(),
      });

      if (updateShouldBeClientVisible) {
        clientPublishedStep = buildTrackingStepSnapshot(step, newUpdate);
      }
    }

    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });

    const refreshedStepIndex = order.trackingSteps.findIndex((state) => state.key === stepKey);
    const refreshedStep = refreshedStepIndex >= 0 ? order.trackingSteps[refreshedStepIndex] : null;

    if (!refreshedStep) {
      return res.status(404).json({ message: "Tracking state not found" });
    }

    refreshedStep.confirmed = requestedConfirmed;
    refreshedStep.inProgress = requestedConfirmed ? false : requestedInProgress;

    const preferredActiveIndex = requestedConfirmed
      ? findNextIncompleteTrackingStepIndex(order.trackingSteps, refreshedStepIndex)
      : refreshedStep.inProgress
        ? refreshedStepIndex
        : -1;

    syncTrackingStepProgression(order.trackingSteps, preferredActiveIndex);

    const latestUpdate = getLatestTrackingStepUpdate(refreshedStep);
    const progressionTimestamp = latestUpdate?.updatedAt || latestUpdate?.createdAt || new Date();
    const activeStepAfterSync = order.trackingSteps.find((item) => item?.inProgress && !item?.confirmed) || null;

    if (requestedConfirmed && activeStepAfterSync && activeStepAfterSync.key !== refreshedStep.key) {
      const autoActivatedUpdate = ensureTrackingStepLifecycleUpdate(activeStepAfterSync, {
        notes: "Estado activado automaticamente al completar la etapa anterior.",
        clientVisible: false,
        inProgress: true,
        completed: false,
        timestamp: progressionTimestamp,
      });

      if (autoActivatedUpdate && !autoActivatedUpdate.eventId) {
        await createTrackingEvent({
          orderId: order._id,
          orderRegion: orderResult.region,
          stepKey: activeStepAfterSync.key,
          notes: autoActivatedUpdate.notes,
          media: autoActivatedUpdate.media || [],
          clientVisible: Boolean(autoActivatedUpdate.clientVisible),
          inProgress: Boolean(autoActivatedUpdate.completed ? false : autoActivatedUpdate.inProgress),
          completed: Boolean(autoActivatedUpdate.completed),
          timestamp: autoActivatedUpdate.updatedAt || autoActivatedUpdate.createdAt || progressionTimestamp,
        });
      }

      activeStepAfterSync.notes = autoActivatedUpdate?.notes || activeStepAfterSync.notes || "";
      activeStepAfterSync.updatedAt = autoActivatedUpdate?.updatedAt || autoActivatedUpdate?.createdAt || progressionTimestamp;
      syncTrackingStepDerivedFields(activeStepAfterSync);
    }

    syncTrackingStepDerivedFields(refreshedStep);

    const updatedOrder = await persistTrackingOrderState(orderResult, order);

    // Automatizar agendamiento de mantenimiento si es LATAM y se confirma 'delivery'
    const updatedStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === stepKey);

    if (orderResult.region === "latam" && stepKey === "delivery" && updatedStep?.confirmed) {
      await syncMaintenanceSchedule(order, req.user._id);
    }

    let notificationSummary = {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };

    if (clientPublishedStep?.clientVisible) {
      notificationSummary = await notifyPublishedTrackingStep(updatedOrder, previousConfirmedStep, clientPublishedStep);
    } else if (visibilityPublicationEvent && requestedClientVisible && !visibilityPreviouslyVisible && updatedStep) {
      const publishedStep = buildTrackingStepSnapshot(updatedStep, mapTrackingEventToUpdate(visibilityPublicationEvent));
      notificationSummary = await notifyPublishedTrackingStep(updatedOrder, previousConfirmedStep, publishedStep);
    } else if (!(operation === "toggle-update-visibility" || requestedVisibilityOnly || requestedMediaVisibilityOnly)) {
      await sendTrackingUpdateAdminNotifications(updatedOrder, updatedStep).catch(() => null);
      await sendTrackingUpdateAdminEmails(updatedOrder, previousConfirmedStep, updatedStep).catch(() => null);
    }

    return res.status(200).json({
      message: "Tracking state updated successfully",
      notificationSummary,
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: "Error updating tracking state" });
  }
}

async function transitionTrackingState(req, res) {
  try {
    const { orderId } = req.params;
    const direction = String(req.body?.direction || "").trim().toLowerCase();

    if (!["previous", "next"].includes(direction)) {
      return res.status(400).json({ message: "Direccion de transicion invalida" });
    }

    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));
    await backfillTrackingEventsFromOrder(order, orderResult.region);
    order.trackingEventCollectionEnabled = true;
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });
    order.trackingSteps = (order.trackingSteps || []).map((trackingStep) => syncTrackingStepFlagsFromLatestUpdate(trackingStep));

    const currentStepIndex = getCurrentTrackingStepIndex(order.trackingSteps);

    if (currentStepIndex < 0) {
      return res.status(409).json({ message: "No se pudo determinar la etapa actual del pedido" });
    }

    const targetStepIndex = direction === "next" ? currentStepIndex + 1 : currentStepIndex - 1;

    if (targetStepIndex < 0 || targetStepIndex >= order.trackingSteps.length) {
      return res.status(409).json({ message: direction === "next" ? "El pedido ya esta en la ultima etapa" : "El pedido ya esta en la primera etapa" });
    }

    if (!canTransitionTrackingStep(req.user, currentStepIndex, targetStepIndex)) {
      return res.status(403).json({ message: "No tienes permisos para mover este pedido entre etapas" });
    }

    const now = new Date();
    const currentStep = order.trackingSteps[currentStepIndex];
    const targetStep = order.trackingSteps[targetStepIndex];
    const currentStateMeta = TRACKING_STATE_TEMPLATES[currentStepIndex] || { key: currentStep.key, label: currentStep.label };
    const targetStateMeta = TRACKING_STATE_TEMPLATES[targetStepIndex] || { key: targetStep.key, label: targetStep.label };
    const transitionTitle = direction === "next"
      ? `Cambio de etapa a E${targetStepIndex + 1} — ${targetStateMeta.label}`
      : `Retroceso de etapa a E${targetStepIndex + 1} — ${targetStateMeta.label}`;
    const transitionNotes = String(req.body?.notes || "").trim()
      || (direction === "next"
        ? `La orden avanzo a ${targetStateMeta.label}.`
        : `La orden regreso a ${targetStateMeta.label}.`);
    const transitionLocation = String(req.body?.location || "").trim();
    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, targetStep.key);

    if (direction === "next") {
      currentStep.confirmed = true;
      currentStep.inProgress = false;

      ensureTrackingStepLifecycleUpdate(currentStep, {
        notes: `Etapa completada al avanzar a E${targetStepIndex + 1}.`,
        clientVisible: false,
        inProgress: false,
        completed: true,
        timestamp: now,
      });
    } else {
      currentStep.confirmed = false;
      currentStep.inProgress = false;
    }

    targetStep.confirmed = false;
    targetStep.inProgress = true;

    await createTrackingEvent({
      orderId: order._id,
      orderRegion: orderResult.region,
      stepKey: targetStep.key,
      title: transitionTitle,
      location: transitionLocation,
      notes: transitionNotes,
      media: [],
      clientVisible: direction === "next",
      inProgress: true,
      completed: false,
      timestamp: now,
    });

    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });
    syncTrackingStepProgression(order.trackingSteps, targetStepIndex);
    order.trackingSteps.forEach((step) => syncTrackingStepDerivedFields(step));

    const updatedOrder = await persistTrackingOrderState(orderResult, order);
    const updatedTargetStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === targetStep.key);
    let notificationSummary = {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };

    if (direction === "next" && updatedTargetStep) {
      const publishedStep = buildTrackingStepSnapshot(updatedTargetStep, {
        title: transitionTitle,
        location: transitionLocation,
        notes: transitionNotes,
        media: [],
        clientVisible: true,
        inProgress: true,
        completed: false,
        createdAt: now,
        updatedAt: now,
      });

      notificationSummary = await notifyPublishedTrackingStep(updatedOrder, previousConfirmedStep, publishedStep);
    }

    return res.status(200).json({
      message: "Tracking transition updated successfully",
      notificationSummary,
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating tracking transition" });
  }
}

async function finalizeTrackingOrder(req, res) {
  try {
    const { orderId } = req.params;
    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));
    await backfillTrackingEventsFromOrder(order, orderResult.region);
    order.trackingEventCollectionEnabled = true;
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });
    order.trackingSteps = (order.trackingSteps || []).map((trackingStep) => syncTrackingStepFlagsFromLatestUpdate(trackingStep));

    const currentStepIndex = getCurrentTrackingStepIndex(order.trackingSteps);

    if (currentStepIndex < 0) {
      return res.status(409).json({ message: "No se pudo determinar la etapa actual del pedido" });
    }

    if (!canFinalizeTrackingOrder(req.user, order, currentStepIndex, orderResult.region)) {
      return res.status(403).json({ message: "No tienes permisos para finalizar este pedido" });
    }

    const finalizationStartIndex = currentStepIndex;
    const finalStep = order.trackingSteps[order.trackingSteps.length - 1];
    const originStateMeta = TRACKING_STATE_TEMPLATES[finalizationStartIndex] || {
      key: order.trackingSteps[finalizationStartIndex]?.key,
      label: order.trackingSteps[finalizationStartIndex]?.label,
    };
    const now = new Date();
    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, finalStep.key);

    for (let stepIndex = finalizationStartIndex; stepIndex < order.trackingSteps.length; stepIndex += 1) {
      const step = order.trackingSteps[stepIndex];

      if (!step) {
        continue;
      }

      const stepMeta = TRACKING_STATE_TEMPLATES[stepIndex] || { key: step.key, label: step.label };
      const isOriginStep = stepIndex === finalizationStartIndex;
      const eventTimestamp = new Date(now.getTime() + (stepIndex - finalizationStartIndex) * 1000);
      const notes = isOriginStep
        ? `Pedido finalizado en E${finalizationStartIndex + 1} — ${originStateMeta.label}.`
        : `Etapa completada automaticamente al finalizar el pedido desde E${finalizationStartIndex + 1} — ${originStateMeta.label}.`;
      const title = isOriginStep
        ? `Pedido finalizado en E${finalizationStartIndex + 1} — ${originStateMeta.label}`
        : `Etapa completada por finalizacion del pedido — E${stepIndex + 1} — ${stepMeta.label}`;

      step.confirmed = true;
      step.inProgress = false;

      ensureTrackingStepLifecycleUpdate(step, {
        notes,
        clientVisible: true,
        inProgress: false,
        completed: true,
        timestamp: eventTimestamp,
      });

      await createTrackingEvent({
        orderId: order._id,
        orderRegion: orderResult.region,
        stepKey: step.key,
        title,
        location: isOriginStep ? String(req.body?.location || "").trim() : "",
        notes: isOriginStep
          ? String(req.body?.notes || "").trim() || `La orden finalizo en ${originStateMeta.label}.`
          : notes,
        media: [],
        clientVisible: true,
        inProgress: false,
        completed: true,
        timestamp: eventTimestamp,
      });
    }

    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });
    syncTrackingStepProgression(order.trackingSteps, -1);
    order.trackingSteps.forEach((step) => syncTrackingStepDerivedFields(step));

    const updatedOrder = await persistTrackingOrderState(orderResult, order);
    const updatedFinalStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === finalStep.key);
    let notificationSummary = {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };

    if (updatedFinalStep) {
      const publishedStep = buildTrackingStepSnapshot(updatedFinalStep, {
        title: `Pedido finalizado en E${finalizationStartIndex + 1} — ${originStateMeta.label}`,
        notes: `La orden finalizo en ${originStateMeta.label}.`,
        media: [],
        clientVisible: true,
        inProgress: false,
        completed: true,
        createdAt: now,
        updatedAt: now,
      });

      notificationSummary = await notifyPublishedTrackingStep(updatedOrder, previousConfirmedStep, publishedStep);
    }

    return res.status(200).json({
      message: "Order finalized successfully",
      notificationSummary,
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error finalizing order" });
  }
}

async function toggleTrackingEventVisibility(req, res) {
  try {
    const { orderId, eventId } = req.params;
    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));
    await backfillTrackingEventsFromOrder(order, orderResult.region);
    order.trackingEventCollectionEnabled = true;
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });

    const requestedClientVisible = parseBooleanValue(req.body.clientVisible, false);
    const targetEvent = await OrderTrackingEvent.findOne(
      {
        _id: String(eventId || "").trim(),
        orderId: order._id,
        orderRegion: orderResult.region,
      }
    );

    if (!targetEvent) {
      return res.status(404).json({ message: "Subestado no encontrado" });
    }

    const previousClientVisible = Boolean(targetEvent.clientVisible);
    const previousConfirmedStep = getLatestConfirmedVisibleStep(order.trackingSteps, targetEvent.stepKey);

    targetEvent.clientVisible = requestedClientVisible;
    targetEvent.updatedAt = new Date();
    await targetEvent.save();

    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });

    const updatedOrder = await persistTrackingOrderState(orderResult, order);
    const updatedStep = (updatedOrder?.trackingSteps || []).find((state) => state.key === targetEvent.stepKey) || null;

    let notificationSummary = {
      clientPushSent: 0,
      clientPushSkipped: 0,
    };

    if (requestedClientVisible && !previousClientVisible && updatedStep) {
      const publishedStep = buildTrackingStepSnapshot(updatedStep, mapTrackingEventToUpdate(targetEvent));
      notificationSummary = await notifyPublishedTrackingStep(updatedOrder, previousConfirmedStep, publishedStep);
    }

    return res.status(200).json({
      message: "Tracking event visibility updated successfully",
      notificationSummary,
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating tracking event visibility" });
  }
}

async function deleteTrackingUpdate(req, res) {
  try {
    const { orderId, stepKey, updateIndex: rawUpdateIndex } = req.params;
    const requestedEventId = String(req.query.eventId || "").trim();
    const updateIndex = parseTrackingUpdateIndex(rawUpdateIndex);
    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    (order.trackingSteps || []).forEach((trackingStep) => hydrateTrackingStepMediaFromFlattenedState(trackingStep));
    await backfillTrackingEventsFromOrder(order, orderResult.region);
    order.trackingEventCollectionEnabled = true;
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });

    const stepIndex = order.trackingSteps.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) {
      return res.status(404).json({ message: "Tracking state not found" });
    }

    const step = order.trackingSteps[stepIndex];
    const stepEvents = await fetchTrackingStepEvents(order._id, orderResult.region, stepKey);
    const targetEvent = resolveTrackingEventByReference(stepEvents, {
      eventId: requestedEventId,
      updateIndex,
    });

    if (!targetEvent) {
      return res.status(404).json({ message: "Subestado no encontrado" });
    }

    if (!canManageTrackingEventDeletionRequests(req.user)) {
      if (String(targetEvent.deletionRequest?.status || "none") === "pending") {
        return res.status(409).json({ message: "Este evento ya tiene una solicitud de eliminación pendiente." });
      }

      targetEvent.deletionRequest = {
        status: "pending",
        requestedBy: req.user?._id || null,
        requestedByRole: String(req.user?.role || "").trim(),
        requestedAt: new Date(),
        reason: "Solicitud de eliminación enviada desde el módulo de tracking.",
        reviewedBy: null,
        reviewedByRole: "",
        reviewedAt: null,
        rejectionReason: "",
      };
      targetEvent.updatedAt = new Date();
      await targetEvent.save();

      const updatedOrder = await persistTrackingOrderState(orderResult, order);

      return res.status(202).json({
        message: "Solicitud de eliminación enviada a Anthony para aprobación.",
        requestPending: true,
        order: await serializeOrder(updatedOrder, orderResult.region),
      });
    }

    await targetEvent.deleteOne();
    order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
      preferCollectionOnly: true,
    });

    const updatedOrder = await persistTrackingOrderState(orderResult, order);

    return res.status(200).json({
      message: "Subestado eliminado correctamente",
      order: await serializeOrder(updatedOrder, orderResult.region),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error deleting tracking update" });
  }
}

async function reviewTrackingEventDeletionRequest(req, res) {
  try {
    if (!canManageTrackingEventDeletionRequests(req.user)) {
      return res.status(403).json({ message: "No tienes permisos para revisar solicitudes de eliminación de eventos" });
    }

    const { orderId, eventId } = req.params;
    const action = String(req.body.action || "").trim().toLowerCase();
    const rejectionReason = String(req.body.rejectionReason || "").trim();
    const orderResult = await findOrderForRole(orderId, req.user);
    const order = orderResult.order;

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const targetEvent = await OrderTrackingEvent.findOne({
      _id: String(eventId || "").trim(),
      orderId: order._id,
      orderRegion: orderResult.region,
    });

    if (!targetEvent) {
      return res.status(404).json({ message: "Subestado no encontrado" });
    }

    if (String(targetEvent.deletionRequest?.status || "none") !== "pending") {
      return res.status(400).json({ message: "Este evento no tiene una solicitud pendiente" });
    }

    if (action === "approve") {
      await targetEvent.deleteOne();

      order.trackingSteps = await buildHydratedTrackingSteps(order.trackingSteps || [], order._id, orderResult.region, {
        preferCollectionOnly: true,
      });

      const updatedOrder = await persistTrackingOrderState(orderResult, order);

      return res.status(200).json({
        message: "Evento eliminado correctamente",
        order: await serializeOrder(updatedOrder, orderResult.region),
      });
    }

    if (action !== "reject") {
      return res.status(400).json({ message: "Acción no válida" });
    }

    targetEvent.deletionRequest = {
      ...(targetEvent.deletionRequest?.toObject?.() || targetEvent.deletionRequest || {}),
      status: "rejected",
      reviewedBy: req.user?._id || null,
      reviewedByRole: String(req.user?.role || "").trim(),
      reviewedAt: new Date(),
      rejectionReason,
    };
    targetEvent.updatedAt = new Date();
    await targetEvent.save();

    return res.status(200).json({
      message: "Solicitud rechazada correctamente",
    });
  } catch (error) {
    return res.status(500).json({ message: "Error reviewing tracking event deletion request" });
  }
}

module.exports = {
  addOrderAccountingExpense,
  createOrder,
  deleteOrderAccountingExpense,
  deleteOrderDocument,
  deleteTrackingUpdate,
  finalizeTrackingOrder,
  getOrder,
  listOrderDeletionRequests,
  listOrders,
  requestOrderDeletion,
  reviewTrackingEventDeletionRequest,
  reviewOrderDeletionRequest,
  suggestTrackingNumber,
  toggleOrderDocumentVisibility,
  transitionTrackingState,
  toggleTrackingEventVisibility,
  uploadOrderDocuments,
  updateOrder,
  updateOrderVehiclePricing,
  updateTrackingState,
};