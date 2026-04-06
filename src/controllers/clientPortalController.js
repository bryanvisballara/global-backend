const ClientRequest = require("../models/ClientRequest");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const Post = require("../models/Post");

function buildNotifications(posts, orders, maintenanceItems) {
  const notifications = [];

  posts.slice(0, 4).forEach((post) => {
    notifications.push({
      id: `post-${post._id}`,
      type: "post",
      title: post.title,
      message: post.body,
      date: post.publishedAt || post.createdAt,
    });
  });

  orders.forEach((order) => {
    const stepWithUpdate = [...(order.trackingSteps || [])]
      .filter((step) => step.updatedAt || step.status === "active" || step.status === "completed")
      .sort((left, right) => {
        const leftDate = new Date(left.updatedAt || order.createdAt).getTime();
        const rightDate = new Date(right.updatedAt || order.createdAt).getTime();

        return rightDate - leftDate;
      })[0];

    if (!stepWithUpdate) {
      return;
    }

    notifications.push({
      id: `tracking-${order._id}-${stepWithUpdate.key}`,
      type: "tracking",
      title: `Tracking ${order.trackingNumber}`,
      message: `${stepWithUpdate.label}: ${stepWithUpdate.notes || "Tu orden tiene una nueva actualizacion."}`,
      date: stepWithUpdate.updatedAt || order.createdAt,
    });
  });

  maintenanceItems.forEach((item) => {
    if (item.lastNotificationAt) {
      notifications.push({
        id: `maintenance-notification-${item._id}`,
        type: "maintenance",
        title: `Mantenimiento ${item.order?.trackingNumber || "activo"}`,
        message: item.contactNotes || "Global Imports te ha enviado una actualizacion de mantenimiento.",
        date: item.lastNotificationAt,
      });
    }

    if (item.status === "due") {
      notifications.push({
        id: `maintenance-due-${item._id}`,
        type: "maintenance",
        title: `Mantenimiento por vencer ${item.order?.trackingNumber || ""}`.trim(),
        message: "Tu mantenimiento preventivo ya necesita atencion.",
        date: item.dueDate,
      });
    }
  });

  return notifications
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 8);
}

function normalizePaginationValue(value, fallback, maxValue = 20) {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.min(parsedValue, maxValue);
}

async function getClientDashboard(req, res) {
  try {
    const [notificationPosts, orders, maintenance] = await Promise.all([
      Post.find({ status: "published" }).populate("publishedBy", "name email role").sort({ publishedAt: -1, createdAt: -1 }).limit(4),
      Order.find({ client: req.user._id })
        .populate("client", "name email phone role")
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 }),
      Maintenance.find({ client: req.user._id })
        .populate("client", "name email phone role")
        .populate({
          path: "order",
          select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
        })
        .sort({ dueDate: 1 }),
    ]);

    return res.status(200).json({
      user: req.user,
      orders,
      maintenance,
      notifications: buildNotifications(notificationPosts, orders, maintenance),
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client dashboard" });
  }
}

async function listClientPosts(req, res) {
  try {
    const offset = normalizePaginationValue(req.query.offset, 0, 1000);
    const limit = normalizePaginationValue(req.query.limit, 5, 10);

    const posts = await Post.find({ status: "published" })
      .populate("publishedBy", "name email role")
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit + 1);

    const hasMore = posts.length > limit;

    return res.status(200).json({
      posts: hasMore ? posts.slice(0, limit) : posts,
      pagination: {
        offset,
        limit,
        nextOffset: offset + limit,
        hasMore,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client posts" });
  }
}

async function createAuthenticatedClientRequest(req, res) {
  try {
    const { customerPhone, vehicle, reservationAmount, currency, notes } = req.body;

    if (!customerPhone || !vehicle || !vehicle.brand || !vehicle.model || reservationAmount == null) {
      return res.status(400).json({
        message: "customerPhone, vehicle and reservationAmount are required",
      });
    }

    const clientRequest = await ClientRequest.create({
      client: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: String(customerPhone).trim(),
      vehicle: {
        brand: String(vehicle.brand).trim(),
        model: String(vehicle.model).trim(),
        color: vehicle.color ? String(vehicle.color).trim() : undefined,
        upholstery: vehicle.upholstery ? String(vehicle.upholstery).trim() : undefined,
        version: vehicle.version ? String(vehicle.version).trim() : undefined,
        year: vehicle.year ? Number(vehicle.year) : undefined,
      },
      reservationAmount: Number(reservationAmount),
      currency: currency ? String(currency).trim().toUpperCase() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      source: "client-portal-authenticated",
    });

    return res.status(201).json({
      message: "Client request created successfully",
      clientRequest,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error creating client request" });
  }
}

async function updateClientMaintenance(req, res) {
  try {
    const { maintenanceId } = req.params;
    const { reportedMileage, lastServiceDate, clientNotes } = req.body;
    const maintenance = await Maintenance.findById(maintenanceId)
      .populate("client", "name email phone role")
      .populate({
        path: "order",
        select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
      });

    if (!maintenance) {
      return res.status(404).json({ message: "Maintenance not found" });
    }

    if (String(maintenance.client?._id || maintenance.client) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (reportedMileage != null && reportedMileage !== "") {
      maintenance.reportedMileage = Number(reportedMileage);
    }

    if (lastServiceDate) {
      maintenance.lastServiceDate = lastServiceDate;
    }

    if (typeof clientNotes === "string") {
      maintenance.clientNotes = clientNotes.trim();
    }

    maintenance.lastClientUpdateAt = new Date();

    await maintenance.save();

    return res.status(200).json({
      message: "Maintenance report updated successfully",
      maintenance,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating client maintenance" });
  }
}

module.exports = {
  createAuthenticatedClientRequest,
  getClientDashboard,
  listClientPosts,
  updateClientMaintenance,
};