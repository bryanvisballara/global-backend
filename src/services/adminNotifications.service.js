const AdminNotification = require("../models/AdminNotification");

const LATAM_ROLES = ["admin", "manager"];
const USA_ROLES = ["adminUSA", "gerenteUSA"];
const ALL_ADMIN_ROLES = [...LATAM_ROLES, ...USA_ROLES];
const DELETION_MANAGER_ROLES = ["manager", "gerenteUSA"];

function normalizeText(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function userIdInList(list = [], userId) {
  const id = String(userId || "");
  return (list || []).some((entry) => String(entry?.user || "") === id);
}

async function createAdminNotification(payload = {}) {
  try {
    const type = normalizeText(payload.type, 80);
    const title = normalizeText(payload.title, 180);
    const deepLink = normalizeText(payload.deepLink, 240);

    if (!type || !title || !deepLink) {
      return null;
    }

    const doc = await AdminNotification.create({
      type,
      title,
      body: normalizeText(payload.body, 500),
      deepLink,
      entityModel: normalizeText(payload.entityModel, 80),
      entityId: payload.entityId || null,
      meta: payload.meta && typeof payload.meta === "object" ? payload.meta : {},
      createdBy: payload.createdBy || null,
      audienceRoles: Array.isArray(payload.audienceRoles) && payload.audienceRoles.length
        ? payload.audienceRoles
        : LATAM_ROLES,
    });

    return doc;
  } catch (error) {
    console.warn("[ADMIN_NOTIFICATIONS] create failed:", error.message || error);
    return null;
  }
}

function serializeNotification(doc, userId) {
  if (!doc) {
    return null;
  }

  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const isRead = userIdInList(plain.readBy, userId);
  const isDismissed = userIdInList(plain.dismissedBy, userId);

  return {
    id: String(plain._id),
    type: plain.type,
    title: plain.title,
    body: plain.body || "",
    deepLink: plain.deepLink,
    entityModel: plain.entityModel || "",
    entityId: plain.entityId ? String(plain.entityId) : null,
    meta: plain.meta || {},
    createdAt: plain.createdAt || null,
    isRead,
    isDismissed,
  };
}

function buildAudienceFilter(role) {
  return {
    audienceRoles: { $in: [String(role || "").trim()] },
  };
}

async function listNotificationsForUser({ userId, role, limit = 40 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const docs = await AdminNotification.find({
    ...buildAudienceFilter(role),
    "dismissedBy.user": { $ne: userId },
  })
    .sort({ createdAt: -1 })
    .limit(safeLimit)
    .lean();

  return docs.map((doc) => serializeNotification(doc, userId));
}

async function countUnreadForUser({ userId, role } = {}) {
  return AdminNotification.countDocuments({
    ...buildAudienceFilter(role),
    "dismissedBy.user": { $ne: userId },
    "readBy.user": { $ne: userId },
  });
}

async function markNotificationRead({ notificationId, userId, role } = {}) {
  const notification = await AdminNotification.findOne({
    _id: notificationId,
    ...buildAudienceFilter(role),
  });

  if (!notification) {
    return null;
  }

  if (!userIdInList(notification.readBy, userId)) {
    notification.readBy.push({ user: userId, at: new Date() });
    await notification.save();
  }

  return serializeNotification(notification, userId);
}

async function markAllNotificationsRead({ userId, role } = {}) {
  const docs = await AdminNotification.find({
    ...buildAudienceFilter(role),
    "dismissedBy.user": { $ne: userId },
    "readBy.user": { $ne: userId },
  }).select("_id");

  if (!docs.length) {
    return { updated: 0 };
  }

  await AdminNotification.updateMany(
    { _id: { $in: docs.map((doc) => doc._id) } },
    {
      $push: {
        readBy: { user: userId, at: new Date() },
      },
    }
  );

  return { updated: docs.length };
}

async function dismissNotification({ notificationId, userId, role } = {}) {
  const notification = await AdminNotification.findOne({
    _id: notificationId,
    ...buildAudienceFilter(role),
  });

  if (!notification) {
    return null;
  }

  if (!userIdInList(notification.dismissedBy, userId)) {
    notification.dismissedBy.push({ user: userId, at: new Date() });
    await notification.save();
  }

  return serializeNotification(notification, userId);
}

module.exports = {
  ALL_ADMIN_ROLES,
  DELETION_MANAGER_ROLES,
  LATAM_ROLES,
  USA_ROLES,
  createAdminNotification,
  countUnreadForUser,
  dismissNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  serializeNotification,
};
