const Maintenance = require("../models/Maintenance");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");

const CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS = 6;

function addMonths(dateValue, monthsToAdd) {
  const sourceDate = new Date(dateValue);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  const nextDate = new Date(Date.UTC(
    sourceDate.getUTCFullYear(),
    sourceDate.getUTCMonth() + monthsToAdd,
    sourceDate.getUTCDate(),
    12,
    0,
    0,
    0
  ));

  return nextDate;
}

function addDays(dateValue, daysToAdd) {
  const nextDate = new Date(dateValue);
  nextDate.setDate(nextDate.getDate() + daysToAdd);
  return nextDate;
}

function toUtcNoon(dateValue) {
  const sourceDate = new Date(dateValue);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  return new Date(Date.UTC(
    sourceDate.getUTCFullYear(),
    sourceDate.getUTCMonth(),
    sourceDate.getUTCDate(),
    12,
    0,
    0,
    0
  ));
}

function isWithinDaysRange(referenceDate, targetDate, daysRange = 15) {
  const normalizedReference = toUtcNoon(referenceDate);
  const normalizedTarget = toUtcNoon(targetDate);

  if (!normalizedReference || !normalizedTarget) {
    return false;
  }

  const millisecondsDiff = Math.abs(normalizedTarget.getTime() - normalizedReference.getTime());
  const daysDiff = Math.floor(millisecondsDiff / (24 * 60 * 60 * 1000));

  return daysDiff <= daysRange;
}

function isSameMonthAndYear(leftDate, rightDate) {
  return (
    leftDate.getUTCFullYear() === rightDate.getUTCFullYear()
    && leftDate.getUTCMonth() === rightDate.getUTCMonth()
  );
}

function isNextMonthAndYear(leftDate, rightDate) {
  const currentYear = rightDate.getUTCFullYear();
  const currentMonth = rightDate.getUTCMonth();
  const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  const nextMonthYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  return (
    leftDate.getUTCFullYear() === nextMonthYear
    && leftDate.getUTCMonth() === nextMonth
  );
}

async function listMaintenance(req, res) {
  try {
    const dueOnly = req.query.dueOnly === "true";
    const query = dueOnly
      ? {
          dueDate: { $lte: new Date() },
          status: { $in: ["scheduled", "due", "contacted"] },
        }
      : {};

    const [maintenance, clientMaintenanceVehicles] = await Promise.all([
      Maintenance.find(query)
        .populate("client", "name email phone")
        .populate({
          path: "order",
          select: "trackingNumber vehicle purchaseDate status",
        })
        .sort({ dueDate: 1 }),
      ClientMaintenanceVehicle.find({})
        .populate("user", "name email phone")
        .populate("client", "name email phone")
        .sort({ createdAt: -1 }),
    ]);

    const now = new Date();

    const vehiclesWithScheduleDate = clientMaintenanceVehicles
      .map((vehicle) => {
        const lastMaintenanceDate = new Date(vehicle.lastPreventiveMaintenanceDate);
        const dueDateBySchedule = addMonths(lastMaintenanceDate, CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS);

        if (!dueDateBySchedule) {
          return null;
        }

        return {
          ...vehicle.toObject(),
          dueDateBySchedule,
        };
      })
      .filter(Boolean);

    const nextMonthReferenceDate = addMonths(now, 1);

    const dueByDateThisMonth = vehiclesWithScheduleDate
      .filter((vehicle) => isWithinDaysRange(now, vehicle.dueDateBySchedule, 15));

    const dueByDateNextMonth = vehiclesWithScheduleDate
      .filter((vehicle) => isWithinDaysRange(nextMonthReferenceDate, vehicle.dueDateBySchedule, 15));

    const dueByMileageReached = clientMaintenanceVehicles
      .map((vehicle) => {
        const lastMaintenanceDate = new Date(vehicle.lastPreventiveMaintenanceDate);
        const dailyKm = Number(vehicle.usualDailyKm || 0);
        const daysToReach5000 = dailyKm > 0 ? Math.ceil(5000 / dailyKm) : Number.POSITIVE_INFINITY;
        const estimatedDateByMileage = Number.isFinite(daysToReach5000)
          ? addDays(lastMaintenanceDate, daysToReach5000)
          : null;
        const elapsedDays = Math.max(0, Math.floor((now.getTime() - lastMaintenanceDate.getTime()) / (24 * 60 * 60 * 1000)));
        const estimatedKmSinceLastMaintenance = elapsedDays * dailyKm;

        return {
          ...vehicle.toObject(),
          estimatedDateByMileage,
          estimatedKmSinceLastMaintenance,
        };
      })
      .filter((vehicle) => Number(vehicle.estimatedKmSinceLastMaintenance || 0) >= 5000);

    return res.status(200).json({
      maintenance,
      clientMaintenanceVehicles,
      dueByDateThisMonth,
      dueByDateNextMonth,
      dueByMileageReached,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching maintenance schedules" });
  }
}

async function updateMaintenance(req, res) {
  try {
    const { maintenanceId } = req.params;
    const { status, contactNotes, lastNotificationAt, completedAt } = req.body;
    const maintenance = await Maintenance.findById(maintenanceId)
      .populate("client", "name email phone")
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

const ALLOWED_ADMIN_CONTACT_STATUSES = ["pending", "contacted", "will_service", "serviced_elsewhere", "not_interested", "appointment_scheduled"];

async function updateClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const { adminContactStatus, adminContactNotes } = req.body;

    const vehicle = await ClientMaintenanceVehicle.findById(vehicleId)
      .populate("user", "name email phone")
      .populate("client", "name email phone");

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    if (adminContactStatus !== undefined) {
      if (!ALLOWED_ADMIN_CONTACT_STATUSES.includes(adminContactStatus)) {
        return res.status(400).json({ message: "Invalid contact status" });
      }

      vehicle.adminContactStatus = adminContactStatus;
    }

    if (typeof adminContactNotes === "string") {
      vehicle.adminContactNotes = adminContactNotes.trim();
    }

    vehicle.adminLastContactAt = new Date();

    await vehicle.save();

    return res.status(200).json({
      message: "Vehicle contact info updated",
      vehicle,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating vehicle contact info" });
  }
}

module.exports = {
  listMaintenance,
  updateMaintenance,
  updateClientMaintenanceVehicle,
};