const OrderTrackingEvent = require("../models/OrderTrackingEvent");
const { normalizeTrackingStates } = require("../constants/trackingSteps");

function toPlainObject(value) {
  return value?.toObject ? value.toObject() : { ...(value || {}) };
}

function resolveOrderKey(orderId, orderRegion) {
  return `${String(orderRegion || "latam")}:${String(orderId || "")}`;
}

function normalizeEventMedia(media = []) {
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
      clientVisible: Boolean(item.clientVisible),
    }));
}

function mapTrackingEventToUpdate(event) {
  return {
    eventId: String(event?._id || event?.id || ""),
    notes: String(event?.notes || "").trim(),
    media: normalizeEventMedia(event?.media || []),
    clientVisible: Boolean(event?.clientVisible),
    inProgress: Boolean(event?.completed ? false : event?.inProgress),
    completed: Boolean(event?.completed),
    createdAt: event?.createdAt || null,
    updatedAt: event?.updatedAt || event?.createdAt || null,
  };
}

function buildStepEventMap(events = []) {
  const stepEventMap = new Map();

  (events || []).forEach((event) => {
    const stepKey = String(event?.stepKey || "").trim();

    if (!stepKey) {
      return;
    }

    if (!stepEventMap.has(stepKey)) {
      stepEventMap.set(stepKey, []);
    }

    stepEventMap.get(stepKey).push(mapTrackingEventToUpdate(event));
  });

  return stepEventMap;
}

function mergeTrackingStepsWithEvents(sourceTrackingSteps = [], stepEventMap = new Map(), preferCollectionOnly = false) {
  const baseTrackingSteps = normalizeTrackingStates(sourceTrackingSteps || []);
  const mergedTrackingSteps = baseTrackingSteps.map((step) => {
    const stepKey = String(step?.key || "").trim();
    const externalUpdates = stepEventMap.get(stepKey);

    if (externalUpdates) {
      return {
        ...step,
        updates: externalUpdates,
      };
    }

    if (preferCollectionOnly) {
      return {
        ...step,
        updates: [],
      };
    }

    return step;
  });

  return normalizeTrackingStates(mergedTrackingSteps);
}

function buildOrderEventsQuery(orderEntries = []) {
  const idsByRegion = {
    latam: [],
    usa: [],
  };

  (orderEntries || []).forEach((entry) => {
    const orderId = entry?.order?._id || entry?.order?.id;
    const orderRegion = String(entry?.orderRegion || "latam").trim();

    if (!orderId || !idsByRegion[orderRegion]) {
      return;
    }

    idsByRegion[orderRegion].push(orderId);
  });

  const query = [];

  if (idsByRegion.latam.length) {
    query.push({ orderRegion: "latam", orderId: { $in: idsByRegion.latam } });
  }

  if (idsByRegion.usa.length) {
    query.push({ orderRegion: "usa", orderId: { $in: idsByRegion.usa } });
  }

  return query;
}

async function fetchTrackingStepEvents(orderId, orderRegion, stepKey) {
  if (!orderId || !stepKey) {
    return [];
  }

  return OrderTrackingEvent.find({
    orderId,
    orderRegion,
    stepKey,
  }).sort({ createdAt: 1, _id: 1 });
}

async function buildHydratedTrackingSteps(sourceTrackingSteps = [], orderId, orderRegion, options = {}) {
  if (!orderId) {
    return normalizeTrackingStates(sourceTrackingSteps || []);
  }

  const events = await OrderTrackingEvent.find({
    orderId,
    orderRegion,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  return mergeTrackingStepsWithEvents(
    sourceTrackingSteps,
    buildStepEventMap(events),
    Boolean(options.preferCollectionOnly)
  );
}

async function hydrateOrderTracking(order, orderRegion, options = {}) {
  if (!order) {
    return null;
  }

  const plainOrder = toPlainObject(order);
  const orderId = plainOrder._id || plainOrder.id;

  plainOrder.trackingSteps = await buildHydratedTrackingSteps(
    plainOrder.trackingSteps || [],
    orderId,
    orderRegion,
    {
      preferCollectionOnly: options.preferCollectionOnly ?? plainOrder.trackingEventCollectionEnabled,
    }
  );
  plainOrder.orderRegion = orderRegion;

  return plainOrder;
}

async function hydrateOrdersTracking(orderEntries = []) {
  const normalizedEntries = (orderEntries || []).filter((entry) => entry?.order);

  if (!normalizedEntries.length) {
    return [];
  }

  const orderEventsQuery = buildOrderEventsQuery(normalizedEntries);
  const events = orderEventsQuery.length
    ? await OrderTrackingEvent.find({ $or: orderEventsQuery })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  const eventsByOrderKey = new Map();

  events.forEach((event) => {
    const orderKey = resolveOrderKey(event?.orderId, event?.orderRegion);

    if (!eventsByOrderKey.has(orderKey)) {
      eventsByOrderKey.set(orderKey, []);
    }

    eventsByOrderKey.get(orderKey).push(event);
  });

  return normalizedEntries.map((entry) => {
    const plainOrder = toPlainObject(entry.order);
    const orderKey = resolveOrderKey(plainOrder._id || plainOrder.id, entry.orderRegion);

    plainOrder.trackingSteps = mergeTrackingStepsWithEvents(
      plainOrder.trackingSteps || [],
      buildStepEventMap(eventsByOrderKey.get(orderKey) || []),
      Boolean(entry.preferCollectionOnly ?? plainOrder.trackingEventCollectionEnabled)
    );
    plainOrder.orderRegion = entry.orderRegion;

    return plainOrder;
  });
}

async function backfillTrackingEventsFromOrder(order, orderRegion) {
  if (!order?._id || order.trackingEventCollectionEnabled) {
    return false;
  }

  const existingEventsCount = await OrderTrackingEvent.countDocuments({
    orderId: order._id,
    orderRegion,
  });

  if (existingEventsCount > 0) {
    order.trackingEventCollectionEnabled = true;
    return false;
  }

  const sourceTrackingSteps = Array.isArray(order.trackingSteps) ? order.trackingSteps : [];
  const trackingEventDocuments = [];

  sourceTrackingSteps.forEach((step) => {
    if (!Array.isArray(step?.updates) || !step.updates.length) {
      return;
    }

    step.updates.forEach((update) => {
      const createdAt = update?.createdAt || update?.updatedAt || step?.updatedAt || new Date();
      const updatedAt = update?.updatedAt || update?.createdAt || step?.updatedAt || createdAt;

      trackingEventDocuments.push({
        orderId: order._id,
        orderRegion,
        stepKey: String(step?.key || "").trim(),
        notes: String(update?.notes || "").trim(),
        media: normalizeEventMedia(update?.media || []),
        clientVisible: Boolean(update?.clientVisible),
        inProgress: Boolean(update?.completed ? false : update?.inProgress),
        completed: Boolean(update?.completed),
        createdAt,
        updatedAt,
      });
    });
  });

  if (trackingEventDocuments.length) {
    await OrderTrackingEvent.insertMany(trackingEventDocuments, { ordered: true });
  }

  order.trackingEventCollectionEnabled = true;
  return Boolean(trackingEventDocuments.length);
}

async function createTrackingEvent({
  orderId,
  orderRegion,
  stepKey,
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

  return OrderTrackingEvent.create({
    orderId,
    orderRegion,
    stepKey,
    notes: String(notes || "").trim(),
    media: normalizeEventMedia(media),
    clientVisible: Boolean(clientVisible),
    inProgress: completed ? false : Boolean(inProgress),
    completed: Boolean(completed),
    createdAt: resolvedTimestamp,
    updatedAt: resolvedTimestamp,
  });
}

module.exports = {
  backfillTrackingEventsFromOrder,
  buildHydratedTrackingSteps,
  createTrackingEvent,
  fetchTrackingStepEvents,
  hydrateOrderTracking,
  hydrateOrdersTracking,
  mapTrackingEventToUpdate,
};