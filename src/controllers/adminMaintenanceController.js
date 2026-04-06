const Maintenance = require("../models/Maintenance");

async function listMaintenance(req, res) {
  try {
    const dueOnly = req.query.dueOnly === "true";
    const query = dueOnly
      ? {
          dueDate: { $lte: new Date() },
          status: { $in: ["scheduled", "due", "contacted"] },
        }
      : {};

    const maintenance = await Maintenance.find(query)
      .populate("client", "name email phone role")
      .populate({
        path: "order",
        select: "trackingNumber vehicle purchaseDate status",
      })
      .sort({ dueDate: 1 });

    return res.status(200).json({ maintenance });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching maintenance schedules" });
  }
}

async function updateMaintenance(req, res) {
  try {
    const { maintenanceId } = req.params;
    const { status, contactNotes, lastNotificationAt, completedAt } = req.body;
    const maintenance = await Maintenance.findById(maintenanceId)
      .populate("client", "name email phone role")
      .populate({
        path: "order",
        select: "trackingNumber vehicle purchaseDate status",
      });

    if (!maintenance) {
      return res.status(404).json({ message: "Maintenance not found" });
    }

    if (status) {
      maintenance.status = status;
    }

    if (typeof contactNotes === "string") {
      maintenance.contactNotes = contactNotes.trim();
    }

    if (lastNotificationAt) {
      maintenance.lastNotificationAt = lastNotificationAt;
    }

    if (completedAt) {
      maintenance.completedAt = completedAt;
    }

    if (maintenance.status === "completed" && !maintenance.completedAt) {
      maintenance.completedAt = new Date();
    }

    await maintenance.save();

    return res.status(200).json({
      message: "Maintenance updated successfully",
      maintenance,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating maintenance" });
  }
}

module.exports = {
  listMaintenance,
  updateMaintenance,
};