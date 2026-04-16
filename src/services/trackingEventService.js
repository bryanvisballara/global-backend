const OrderTrackingEvent = require("../models/OrderTrackingEvent");
const {
  TRACKING_STATE_TEMPLATES,
  buildTrackingStates,
  normalizeTrackingStates,
} = require("../constants/trackingSteps");

const trackingStateMetaByKey = new Map(
  TRACKING_STATE_TEMPLATES.map((step, index) => [
    step.key,
    {
      key: step.key,
      label: step.label,
      index,
      code: `E${index + 1}`,
    },
  ])
);

function toPlainObject(value) {
  return value?.toObject ? value.toObject() : { ...(value || {}) };
}

function resolveOrderKey(orderId, orderRegion) {
  return `${String(orderRegion || "latam")}:${String(orderId || "")}`;
}

function resolveOrderIdKey(orderId) {
  return String(orderId || "");
}

function resolveTrackingStateMeta(stepKey = "") {
  const normalizedStepKey = String(stepKey || "").trim();

  return trackingStateMetaByKey.get(normalizedStepKey) || {
    key: normalizedStepKey,
    label: normalizedStepKey,
    index: 0,
    code: "E1",
  };
}

function buildTrackingEventStateFields(stepKey = "", source = {}) {
  const stateMeta = resolveTrackingStateMeta(source?.stateKey || source?.stepKey || stepKey);

  return {
    stepKey: stateMeta.key,
    stateKey: stateMeta.key,
    stateLabel: String(source?.stateLabel || stateMeta.label),
    stateIndex: Number.isInteger(source?.stateIndex) ? source.stateIndex : stateMeta.index,
    stateCode: String(source?.stateCode || stateMeta.code),
  };
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

function mapTrackingEventForResponse(event, updateIndex = -1) {
  const stateFields = buildTrackingEventStateFields(event?.stepKey, event);

  return {
    eventId: String(event?._id || event?.id || ""),
    orderId: String(event?.orderId || ""),
    orderRegion: String(event?.orderRegion || ""),
    stepKey: stateFields.stepKey,
    stateKey: stateFields.stateKey,
    stateLabel: stateFields.stateLabel,
    stateIndex: stateFields.stateIndex,
    stateCode: stateFields.stateCode,
    updateIndex,
    notes: String(event?.notes || "").trim(),
    media: normalizeEventMedia(event?.media || []),
    clientVisible: Boolean(event?.clientVisible),
    inProgress: Boolean(event?.completed ? false : event?.inProgress),
    completed: Boolean(event?.completed),
    createdAt: event?.createdAt || null,
    updatedAt: event?.updatedAt || event?.createdAt || null,
  };
}

async function enrichTrackingEventsWithStateFields(events = []) {
  const normalizedEvents = [];
  const bulkOperations = [];

  (events || []).forEach((event) => {
    const stateFields = buildTrackingEventStateFields(event?.stepKey, event);

    normalizedEvents.push({
      ...event,
      ...stateFields,
    });

    const needsUpdate = Boolean(event?._id) && (
      String(event?.stateKey || "") !== stateFields.stateKey ||
      String(event?.stateLabel || "") !== stateFields.stateLabel ||
      Number(event?.stateIndex) !== stateFields.stateIndex ||
      String(event?.stateCode || "") !== stateFields.stateCode
    );

    if (!needsUpdate) {
      return;
    }

    bulkOperations.push({
      updateOne: {
        filter: { _id: event._id },
        update: {
          $set: {
            stateKey: stateFields.stateKey,
            stateLabel: stateFields.stateLabel,
            stateIndex: stateFields.stateIndex,
            stateCode: stateFields.stateCode,
          },
        },
      },
    });
  });

  if (bulkOperations.length) {
    await OrderTrackingEvent.bulkWrite(bulkOperations, { ordered: false });
  }

  return normalizedEvents;
}

function buildTrackingEventsCollection(events = []) {
  const nextUpdateIndexByStateKey = new Map();

  return (events || [])
    .map((event) => {
      const stateKey = String(event?.stateKey || event?.stepKey || "").trim();
      const nextUpdateIndex = nextUpdateIndexByStateKey.get(stateKey) || 0;

      nextUpdateIndexByStateKey.set(stateKey, nextUpdateIndex + 1);

      return mapTrackingEventForResponse(event, nextUpdateIndex);
    })
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();

      return rightTime - leftTime;
    });
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

function buildCollectionTrackingSteps(events = []) {
  return mergeTrackingStepsWithEvents(buildTrackingStates(), buildStepEventMap(events), true);
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
  const orderIds = [];

  (orderEntries || []).forEach((entry) => {
    const orderId = entry?.order?._id || entry?.order?.id;

    if (!orderId) {
      return;
    }

    orderIds.push(orderId);
  });

  return orderIds.length ? { orderId: { $in: orderIds } } : null;
}

async function fetchTrackingStepEvents(orderId, orderRegion, stepKey) {
  if (!orderId || !stepKey) {
    return [];
  }

  const events = await OrderTrackingEvent.find({
    orderId,
    stepKey,
  }).sort({ createdAt: 1, _id: 1 });

  return events.map((event) => {
    const stateFields = buildTrackingEventStateFields(event?.stepKey, event);

    event.stepKey = stateFields.stepKey;
    event.stateKey = stateFields.stateKey;
    event.stateLabel = stateFields.stateLabel;
    event.stateIndex = stateFields.stateIndex;
    event.stateCode = stateFields.stateCode;

    return event;
  });
}

async function buildHydratedTrackingSteps(sourceTrackingSteps = [], orderId, orderRegion, options = {}) {
  if (!orderId) {
    return normalizeTrackingStates(sourceTrackingSteps || []);
  }

  const events = await OrderTrackingEvent.find({
    orderId,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const normalizedEvents = await enrichTrackingEventsWithStateFields(events);

  if (options.preferCollectionOnly) {
    return buildCollectionTrackingSteps(normalizedEvents);
  }

  return mergeTrackingStepsWithEvents(
    sourceTrackingSteps,
    buildStepEventMap(normalizedEvents),
    Boolean(options.preferCollectionOnly)
  );
}

async function hydrateOrderTracking(order, orderRegion, options = {}) {
  if (!order) {
    return null;
  }

  const plainOrder = toPlainObject(order);
  const orderId = plainOrder._id || plainOrder.id;
  const events = await OrderTrackingEvent.find({
    orderId,
  })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const normalizedEvents = await enrichTrackingEventsWithStateFields(events);
  const preferCollectionOnly = Boolean(options.preferCollectionOnly ?? plainOrder.trackingEventCollectionEnabled);

  plainOrder.trackingSteps = preferCollectionOnly
    ? buildCollectionTrackingSteps(normalizedEvents)
    : mergeTrackingStepsWithEvents(
        plainOrder.trackingSteps || [],
        buildStepEventMap(normalizedEvents),
        false
      );
  plainOrder.trackingEvents = buildTrackingEventsCollection(normalizedEvents);
  plainOrder.orderRegion = orderRegion;

  return plainOrder;
}

async function hydrateOrdersTracking(orderEntries = []) {
  const normalizedEntries = (orderEntries || []).filter((entry) => entry?.order);

  if (!normalizedEntries.length) {
    return [];
  }

  const orderEventsQuery = buildOrderEventsQuery(normalizedEntries);
  const events = orderEventsQuery
    ? await OrderTrackingEvent.find(orderEventsQuery)
      .sort({ createdAt: 1, _id: 1 })
      .lean()
    : [];
  const normalizedEvents = await enrichTrackingEventsWithStateFields(events);
  const eventsByOrderKey = new Map();

  normalizedEvents.forEach((event) => {
    const orderKey = resolveOrderIdKey(event?.orderId);

    if (!eventsByOrderKey.has(orderKey)) {
      eventsByOrderKey.set(orderKey, []);
    }

    eventsByOrderKey.get(orderKey).push(event);
  });

  return normalizedEntries.map((entry) => {
    const plainOrder = toPlainObject(entry.order);
    const orderKey = resolveOrderIdKey(plainOrder._id || plainOrder.id);
    const orderEvents = eventsByOrderKey.get(orderKey) || [];
    const preferCollectionOnly = Boolean(entry.preferCollectionOnly ?? plainOrder.trackingEventCollectionEnabled);

    plainOrder.trackingSteps = preferCollectionOnly
      ? buildCollectionTrackingSteps(orderEvents)
      : mergeTrackingStepsWithEvents(
          plainOrder.trackingSteps || [],
          buildStepEventMap(orderEvents),
          false
        );
    plainOrder.trackingEvents = buildTrackingEventsCollection(orderEvents);
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
        ...buildTrackingEventStateFields(step?.key, step),
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
    ...buildTrackingEventStateFields(stepKey),
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