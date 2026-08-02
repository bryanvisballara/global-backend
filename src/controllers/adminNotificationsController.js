const {
  countUnreadForUser,
  dismissNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} = require("../services/adminNotifications.service");

async function listAdminNotifications(req, res) {
  try {
    const notifications = await listNotificationsForUser({
      userId: req.user._id,
      role: req.user.role,
      limit: req.query.limit,
    });

    return res.status(200).json({ notifications });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error listing notifications" });
  }
}

async function getAdminNotificationsUnreadCount(req, res) {
  try {
    const count = await countUnreadForUser({
      userId: req.user._id,
      role: req.user.role,
    });

    return res.status(200).json({ count });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error counting notifications" });
  }
}

async function markAdminNotificationRead(req, res) {
  try {
    const notification = await markNotificationRead({
      notificationId: req.params.notificationId,
      userId: req.user._id,
      role: req.user.role,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notificación no encontrada" });
    }

    return res.status(200).json({ notification });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error marking notification" });
  }
}

async function markAllAdminNotificationsRead(req, res) {
  try {
    const result = await markAllNotificationsRead({
      userId: req.user._id,
      role: req.user.role,
    });

    return res.status(200).json({
      message: "Notificaciones marcadas como leídas",
      ...result,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error marking notifications" });
  }
}

async function dismissAdminNotification(req, res) {
  try {
    const notification = await dismissNotification({
      notificationId: req.params.notificationId,
      userId: req.user._id,
      role: req.user.role,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notificación no encontrada" });
    }

    return res.status(200).json({
      message: "Notificación eliminada",
      notification,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error dismissing notification" });
  }
}

module.exports = {
  dismissAdminNotification,
  getAdminNotificationsUnreadCount,
  listAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
};
