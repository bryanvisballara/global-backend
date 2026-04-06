const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const User = require("../models/User");
const { TRACKING_STEP_TEMPLATES } = require("../constants/trackingSteps");
const { addMonths } = require("../utils/date");

function normalizeMedia(media = []) {
  if (!Array.isArray(media)) {
    return [];
  }

  return media
    .filter((item) => item && item.url && item.type)
    .map((item) => ({
      type: item.type,
      url: String(item.url).trim(),
      caption: item.caption ? String(item.caption).trim() : undefined,
    }));
}

async function syncMaintenanceSchedule(order, adminUserId) {
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
    const { clientId, vehicle, trackingNumber, purchaseDate, expectedArrivalDate, media, notes } = req.body;

    if (!clientId || !vehicle || !vehicle.brand || !vehicle.model || !vehicle.year || !trackingNumber || !purchaseDate) {
      return res.status(400).json({
        message: "clientId, vehicle, trackingNumber and purchaseDate are required",
      });
    }

    const client = await User.findById(clientId);

    if (!client || client.role !== "client") {
      return res.status(404).json({ message: "Client not found" });
    }

    const existingOrder = await Order.findOne({ trackingNumber: trackingNumber.trim() });

    if (existingOrder) {
      return res.status(409).json({ message: "Tracking number already exists" });
    }

    const order = await Order.create({
      client: client._id,
      createdBy: req.user._id,
      trackingNumber: trackingNumber.trim(),
      vehicle: {
        brand: String(vehicle.brand).trim(),
        model: String(vehicle.model).trim(),
        year: Number(vehicle.year),
        vin: vehicle.vin ? String(vehicle.vin).trim() : undefined,
        color: vehicle.color ? String(vehicle.color).trim() : undefined,
        description: vehicle.description ? String(vehicle.description).trim() : undefined,
      },
      purchaseDate,
      expectedArrivalDate,
      media: normalizeMedia(media),
      notes: notes ? String(notes).trim() : undefined,
    });

    await syncMaintenanceSchedule(order, req.user._id);

    const populatedOrder = await Order.findById(order._id)
      .populate("client", "name email phone role")
      .populate("createdBy", "name email role");

    return res.status(201).json({
      message: "Order created successfully",
      order: populatedOrder,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error creating order" });
  }
}

async function listOrders(req, res) {
  try {
    const orders = await Order.find()
      .populate("client", "name email phone role")
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ orders });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching orders" });
  }
}

async function getOrder(req, res) {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("client", "name email phone role")
      .populate("createdBy", "name email role");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.status(200).json({ order });
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
      order.vehicle = {
        ...order.vehicle.toObject(),
        ...vehicle,
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
      .populate("client", "name email phone role")
      .populate("createdBy", "name email role");

    return res.status(200).json({
      message: "Order updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating order" });
  }
}

async function updateTrackingStep(req, res) {
  try {
    const { orderId, stepKey } = req.params;
    const { status, notes, media } = req.body;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const stepIndex = order.trackingSteps.findIndex((step) => step.key === stepKey);

    if (stepIndex === -1) {
      return res.status(404).json({ message: "Tracking step not found" });
    }

    const step = order.trackingSteps[stepIndex];

    if (status) {
      step.status = status;
    }

    if (typeof notes === "string") {
      step.notes = notes.trim();
    }

    if (Array.isArray(media)) {
      step.media = normalizeMedia(media);
    }

    step.updatedAt = new Date();

    if (step.status === "completed" && stepIndex < TRACKING_STEP_TEMPLATES.length - 1) {
      const nextStep = order.trackingSteps[stepIndex + 1];

      if (nextStep.status === "pending") {
        nextStep.status = "active";
      }
    }

    if (stepKey === "completed" && step.status === "completed") {
      order.status = "completed";
    }

    await order.save();

    return res.status(200).json({
      message: "Tracking step updated successfully",
      trackingSteps: order.trackingSteps,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating tracking step" });
  }
}

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  updateTrackingStep,
};