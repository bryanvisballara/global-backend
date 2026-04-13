const ClientRequest = require("../models/ClientRequest");
const Client = require("../models/Client");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const Post = require("../models/Post");
const VirtualShowcaseVehicle = require("../models/VirtualShowcaseVehicle");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { normalizeTrackingStates } = require("../constants/trackingSteps");
const { publishDueScheduledPosts } = require("./adminPostsController");

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
    const stepWithUpdate = normalizeTrackingStates(order.trackingSteps || [])
      .filter((step) => step.confirmed && step.clientVisible && step.updatedAt)
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

function filterDismissedNotifications(notifications, dismissedNotifications = []) {
  const dismissedSet = new Set((dismissedNotifications || []).map((item) => String(item)));

  return (notifications || []).filter((item) => !dismissedSet.has(String(item.id)));
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const rawValue = String(value).trim();

  if (!rawValue) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return new Date(`${rawValue}T12:00:00.000Z`);
  }

  return new Date(rawValue);
}

function normalizeClientMaintenanceVehiclePayload(payload = {}) {
  const ALLOWED_DRIVING_CITIES = ["Barranquilla", "Bogota", "Bucaramanga", "Medellin", "Cali"];
  const brand = String(payload.brand || "").trim();
  const model = String(payload.model || "").trim();
  const version = payload.version ? String(payload.version).trim() : "";
  const plate = String(payload.plate || "").trim().toUpperCase();
  const drivingCity = String(payload.drivingCity || "").trim();

  const year = Number(payload.year);
  const currentMileage = Number(payload.currentMileage);
  const usualDailyKm = Number(payload.usualDailyKm);
  const lastPreventiveMaintenanceDate = parseDateInput(payload.lastPreventiveMaintenanceDate);

  if (!brand || !model || !plate || !lastPreventiveMaintenanceDate || !drivingCity) {
    throw new Error("Debes completar marca, modelo, placa, ubicacion y fecha del ultimo mantenimiento.");
  }

  if (!ALLOWED_DRIVING_CITIES.includes(drivingCity)) {
    throw new Error("Debes seleccionar una ubicacion valida.");
  }

  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    throw new Error("El año debe estar entre 1900 y 2100.");
  }

  if (!Number.isFinite(currentMileage) || currentMileage < 0) {
    throw new Error("El kilometraje actual debe ser un número mayor o igual a 0.");
  }

  if (!Number.isFinite(usualDailyKm) || usualDailyKm < 10 || usualDailyKm > 200) {
    throw new Error("Los km diarios deben estar entre 10 y 200.");
  }

  if (Number.isNaN(lastPreventiveMaintenanceDate.getTime())) {
    throw new Error("La fecha del último mantenimiento no es válida.");
  }

  return {
    brand,
    model,
    version,
    year,
    currentMileage,
    usualDailyKm,
    drivingCity,
    plate,
    lastPreventiveMaintenanceDate,
  };
}

function normalizePaginationValue(value, fallback, maxValue = 20) {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.min(parsedValue, maxValue);
}

function sanitizeOrderForClient(order) {
  const serializedOrder = order?.toObject ? order.toObject() : { ...(order || {}) };

  if (serializedOrder.vehicle) {
    delete serializedOrder.vehicle.description;
    delete serializedOrder.vehicle.internalIdentifier;
  }

  serializedOrder.trackingSteps = normalizeTrackingStates(serializedOrder.trackingSteps || []).filter(
    (step) => step.confirmed && step.clientVisible
  );

  return serializedOrder;
}

function normalizeTrackingNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || "";
  const authCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("globalAppToken="));

  if (!authCookie) {
    return "";
  }

  return authCookie.slice("globalAppToken=".length);
}

function resolveRequestToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.split(" ")[1];

    if (bearerToken && bearerToken !== "null" && bearerToken !== "undefined") {
      return bearerToken;
    }
  }

  return getCookieToken(req);
}

async function resolveOptionalAuthenticatedClient(req) {
  try {
    const token = resolveRequestToken(req);

    if (!token) {
      return null;
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    if (!decodedToken?.sub) {
      return null;
    }

    const user = await User.findById(decodedToken.sub).select("_id email role isActive");

    if (!user || user.role !== "client" || user.isActive === false) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

async function getPublicTrackingOrder(req, res) {
  try {
    const trackingNumber = normalizeTrackingNumber(req.params.trackingNumber);

    if (!trackingNumber) {
      return res.status(400).json({ message: "Tracking number is required" });
    }

    const order = await Order.findOne({
      trackingNumber: {
        $regex: `^${escapeRegex(trackingNumber)}$`,
        $options: "i",
      },
    }).populate("createdBy", "name email role");

    if (!order) {
      return res.status(404).json({ message: "Tracking not found" });
    }

    const authenticatedClient = await resolveOptionalAuthenticatedClient(req);
    let linkedToClient = false;

    if (authenticatedClient && !order.client) {
      const linkedClient = await Client.findOne({
        email: String(authenticatedClient.email || "").toLowerCase().trim(),
      }).select("_id");

      if (linkedClient?._id) {
        order.client = linkedClient._id;
        await order.save();
        linkedToClient = true;
      }
    }

    if (authenticatedClient?.email) {
      const normalizedSubscriberEmail = String(authenticatedClient.email).toLowerCase().trim();
      const existingSubscriberIndex = (order.trackingSubscribers || []).findIndex((subscriber) => {
        const subscriberEmail = String(subscriber?.email || "").toLowerCase().trim();
        const subscriberUserId = String(subscriber?.user || "");
        return subscriberEmail === normalizedSubscriberEmail || subscriberUserId === String(authenticatedClient._id);
      });

      if (existingSubscriberIndex >= 0) {
        order.trackingSubscribers[existingSubscriberIndex].email = normalizedSubscriberEmail;
        order.trackingSubscribers[existingSubscriberIndex].user = authenticatedClient._id;
        order.trackingSubscribers[existingSubscriberIndex].lastViewedAt = new Date();
      } else {
        order.trackingSubscribers.push({
          user: authenticatedClient._id,
          email: normalizedSubscriberEmail,
          subscribedAt: new Date(),
          lastViewedAt: new Date(),
        });
      }

      await order.save();
    }

    return res.status(200).json({
      order: sanitizeOrderForClient(order),
      linkedToClient,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching tracking" });
  }
}

async function getClientDashboard(req, res) {
  try {
    await publishDueScheduledPosts();

    const linkedClient = await Client.findOne({
      email: String(req.user.email || "").toLowerCase().trim(),
    }).select("_id");

    const linkedClientId = linkedClient?._id || null;

    const [notificationPosts, orders, maintenance, maintenanceVehicles] = await Promise.all([
      Post.find({ status: "published" }).populate("publishedBy", "name email role").sort({ publishedAt: -1, createdAt: -1 }).limit(4),
      Order.find(linkedClientId ? { client: linkedClientId } : { _id: null })
        .populate("client", "name email phone")
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 }),
      Maintenance.find(linkedClientId ? { client: linkedClientId } : { _id: null })
        .populate("client", "name email phone")
        .populate({
          path: "order",
          select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
        })
        .sort({ dueDate: 1 }),
      ClientMaintenanceVehicle.find({ user: req.user._id })
        .sort({ createdAt: -1 }),
    ]);

    const sanitizedOrders = orders.map((order) => sanitizeOrderForClient(order));
    const notifications = filterDismissedNotifications(
      buildNotifications(notificationPosts, orders, maintenance),
      req.user.dismissedNotifications
    );

    const nextBadgeCount = notifications.length;

    if ((req.user.notificationBadgeCount || 0) !== nextBadgeCount) {
      req.user.notificationBadgeCount = nextBadgeCount;
      await req.user.save();
    }

    return res.status(200).json({
      user: req.user,
      orders: sanitizedOrders,
      maintenance,
      maintenanceVehicles,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client dashboard" });
  }
}

async function createClientMaintenanceVehicle(req, res) {
  try {
    const normalizedVehicle = normalizeClientMaintenanceVehiclePayload(req.body);

    const linkedClient = await Client.findOne({
      email: String(req.user.email || "").toLowerCase().trim(),
    }).select("_id");

    const vehicle = await ClientMaintenanceVehicle.create({
      user: req.user._id,
      client: linkedClient?._id || null,
      brand: normalizedVehicle.brand,
      model: normalizedVehicle.model,
      version: normalizedVehicle.version || undefined,
      year: normalizedVehicle.year,
      currentMileage: normalizedVehicle.currentMileage,
      usualDailyKm: normalizedVehicle.usualDailyKm,
      drivingCity: normalizedVehicle.drivingCity,
      plate: normalizedVehicle.plate,
      lastPreventiveMaintenanceDate: normalizedVehicle.lastPreventiveMaintenanceDate,
    });

    return res.status(201).json({
      message: "Vehicle added successfully",
      vehicle,
    });
  } catch (error) {
    const statusCode = error.message?.includes("mantenimiento") || error.message?.includes("km") || error.message?.includes("año") || error.message?.includes("ubicacion")
      ? 400
      : 500;
    return res.status(statusCode).json({ message: error.message || "Error creating maintenance vehicle" });
  }
}

async function updateClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const normalizedVehicle = normalizeClientMaintenanceVehiclePayload(req.body);

    const vehicle = await ClientMaintenanceVehicle.findOne({
      _id: vehicleId,
      user: req.user._id,
    });

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    vehicle.brand = normalizedVehicle.brand;
    vehicle.model = normalizedVehicle.model;
    vehicle.version = normalizedVehicle.version || undefined;
    vehicle.year = normalizedVehicle.year;
    vehicle.currentMileage = normalizedVehicle.currentMileage;
    vehicle.usualDailyKm = normalizedVehicle.usualDailyKm;
    vehicle.drivingCity = normalizedVehicle.drivingCity;
    vehicle.plate = normalizedVehicle.plate;
    vehicle.lastPreventiveMaintenanceDate = normalizedVehicle.lastPreventiveMaintenanceDate;

    await vehicle.save();

    return res.status(200).json({
      message: "Vehicle updated successfully",
      vehicle,
    });
  } catch (error) {
    const statusCode = error.message?.includes("mantenimiento") || error.message?.includes("km") || error.message?.includes("año") || error.message?.includes("ubicacion")
      ? 400
      : 500;
    return res.status(statusCode).json({ message: error.message || "Error updating maintenance vehicle" });
  }
}

async function deleteClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;

    const deletedVehicle = await ClientMaintenanceVehicle.findOneAndDelete({
      _id: vehicleId,
      user: req.user._id,
    });

    if (!deletedVehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    return res.status(200).json({
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting maintenance vehicle" });
  }
}

async function dismissClientNotification(req, res) {
  try {
    const notificationId = String(req.params.notificationId || "").trim();

    if (!notificationId) {
      return res.status(400).json({ message: "Notification id is required" });
    }

    if (!Array.isArray(req.user.dismissedNotifications)) {
      req.user.dismissedNotifications = [];
    }

    if (!req.user.dismissedNotifications.includes(notificationId)) {
      req.user.dismissedNotifications.push(notificationId);
      req.user.notificationBadgeCount = Math.max(0, Number(req.user.notificationBadgeCount || 0) - 1);
      await req.user.save();
    }

    return res.status(200).json({
      message: "Notification dismissed successfully",
      dismissedNotifications: req.user.dismissedNotifications,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error dismissing notification" });
  }
}

async function registerClientPushDevice(req, res) {
  try {
    const token = String(req.body.token || "").trim();
    const platform = String(req.body.platform || "").trim().toLowerCase();
    const provider = String(req.body.provider || "").trim().toLowerCase();
    const appVersion = req.body.appVersion ? String(req.body.appVersion).trim() : undefined;

    if (!token || !platform || !provider) {
      return res.status(400).json({ message: "token, platform and provider are required" });
    }

    if (!["ios", "android"].includes(platform)) {
      return res.status(400).json({ message: "Unsupported platform" });
    }

    if (!["apns", "fcm"].includes(provider)) {
      return res.status(400).json({ message: "Unsupported provider" });
    }

    await User.updateMany(
      { "pushDevices.token": token, _id: { $ne: req.user._id } },
      {
        $pull: {
          pushDevices: { token },
        },
      }
    );

    const nextDevices = Array.isArray(req.user.pushDevices) ? [...req.user.pushDevices] : [];
    const existingDeviceIndex = nextDevices.findIndex((item) => item.token === token);
    const nextDevice = {
      token,
      platform,
      provider,
      appVersion,
      lastRegisteredAt: new Date(),
    };

    if (existingDeviceIndex >= 0) {
      nextDevices[existingDeviceIndex] = nextDevice;
    } else {
      nextDevices.push(nextDevice);
    }

    req.user.pushDevices = nextDevices;
    await req.user.save();

    return res.status(200).json({
      message: "Push device registered successfully",
      pushDevices: req.user.pushDevices,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error registering push device" });
  }
}

async function listClientPosts(req, res) {
  try {
    await publishDueScheduledPosts();

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

async function listClientVirtualDealershipVehicles(req, res) {
  try {
    const vehicles = await VirtualShowcaseVehicle.find({
      isPublished: true,
      status: { $in: ["available", "reserved"] },
    })
      .populate("listedBy", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ vehicles });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching virtual dealership vehicles" });
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
      .populate("client", "name email phone")
      .populate({
        path: "order",
        select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
      });

    if (!maintenance) {
      return res.status(404).json({ message: "Maintenance not found" });
    }

    const linkedClient = await Client.findOne({
      email: String(req.user.email || "").toLowerCase().trim(),
    }).select("_id");

    if (String(maintenance.client?._id || maintenance.client) !== String(linkedClient?._id || "")) {
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
  dismissClientNotification,
  createClientMaintenanceVehicle,
  updateClientMaintenanceVehicle,
  deleteClientMaintenanceVehicle,
  getClientDashboard,
  getPublicTrackingOrder,
  listClientPosts,
  listClientVirtualDealershipVehicles,
  registerClientPushDevice,
  updateClientMaintenance,
};