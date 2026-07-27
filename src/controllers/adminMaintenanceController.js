const Maintenance = require("../models/Maintenance");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const Order = require("../models/Order");
const {
  CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS,
  toUtcNoon,
  resolveOrderMaintenanceActivationDate,
  resolveMaintenanceDueDate,
  resolveMaintenanceStatus,
  backfillCompletedOrderMaintenance,
  isSameMonthAndYear,
  buildMonthKey,
  parseMonthKey,
} = require("../services/maintenanceScheduleService");

function addDays(dateValue, daysToAdd) {
  const nextDate = new Date(dateValue);
  nextDate.setDate(nextDate.getDate() + daysToAdd);
  return nextDate;
}

function addMonthsLocal(dateValue, monthsToAdd) {
  const sourceDate = new Date(dateValue);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  return toUtcNoon(new Date(Date.UTC(
    sourceDate.getUTCFullYear(),
    sourceDate.getUTCMonth() + monthsToAdd,
    sourceDate.getUTCDate(),
    12,
    0,
    0,
    0
  )));
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

function normalizeRequesterRole(requester) {
  if (requester && typeof requester === "object") {
    return String(requester.role || "");
  }

  return String(requester || "");
}

function canAccessLatamOrders(requester) {
  const normalizedRole = normalizeRequesterRole(requester);
  return normalizedRole === "admin" || normalizedRole === "manager";
}

function formatMonthLabel(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0, 0));
  const label = new Intl.DateTimeFormat("es-CO", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function buildMonthSummary(items) {
  const counts = new Map();

  items.forEach((item) => {
    const monthKey = buildMonthKey(item.dueDate);

    if (!monthKey) {
      return;
    }

    counts.set(monthKey, (counts.get(monthKey) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([key, count]) => {
      const parsed = parseMonthKey(key);
      return {
        key,
        year: parsed.year,
        month: parsed.monthIndex + 1,
        count,
        label: formatMonthLabel(parsed.year, parsed.monthIndex),
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function mapOrderMaintenanceRow(order, maintenanceRecord) {
  const activationDate = resolveOrderMaintenanceActivationDate(order)
    || toUtcNoon(maintenanceRecord?.activationDate);

  if (!activationDate) {
    return null;
  }

  const resolvedDueDate = toUtcNoon(maintenanceRecord?.dueDate)
    || resolveMaintenanceDueDate(activationDate);

  if (!resolvedDueDate) {
    return null;
  }

  const currentStatus = resolveMaintenanceStatus(resolvedDueDate, maintenanceRecord?.status);

  return {
    maintenanceId: String(maintenanceRecord?._id || "").trim(),
    source: "order",
    order: order.toObject ? order.toObject() : order,
    client: order?.client?.toObject ? order.client.toObject() : order?.client || null,
    activationDate,
    dueDate: resolvedDueDate,
    status: currentStatus,
    reportedMileage: maintenanceRecord?.reportedMileage ?? null,
    clientNotes: maintenanceRecord?.clientNotes || "",
    contactNotes: maintenanceRecord?.contactNotes || "",
    contactName: maintenanceRecord?.contactName || "",
    contactPhone: maintenanceRecord?.contactPhone || "",
    contactEmail: maintenanceRecord?.contactEmail || "",
    vehicleSnapshot: maintenanceRecord?.vehicleSnapshot || {
      brand: order?.vehicle?.brand || "",
      model: order?.vehicle?.model || "",
      version: order?.vehicle?.version || "",
      year: order?.vehicle?.year || null,
      vin: order?.vehicle?.vin || "",
      plate: order?.vehicle?.plate || "",
    },
  };
}

function mapManualMaintenanceRow(maintenanceRecord) {
  const dueDate = toUtcNoon(maintenanceRecord?.dueDate);

  if (!dueDate) {
    return null;
  }

  return {
    maintenanceId: String(maintenanceRecord?._id || "").trim(),
    source: "manual",
    order: null,
    client: maintenanceRecord?.client || null,
    activationDate: toUtcNoon(maintenanceRecord?.activationDate),
    dueDate,
    status: resolveMaintenanceStatus(dueDate, maintenanceRecord?.status),
    reportedMileage: maintenanceRecord?.reportedMileage ?? null,
    clientNotes: maintenanceRecord?.clientNotes || "",
    contactNotes: maintenanceRecord?.contactNotes || "",
    contactName: maintenanceRecord?.contactName || "",
    contactPhone: maintenanceRecord?.contactPhone || "",
    contactEmail: maintenanceRecord?.contactEmail || "",
    vehicleSnapshot: maintenanceRecord?.vehicleSnapshot || {},
  };
}

async function listMaintenance(req, res) {
  try {
    const dueOnly = req.query.dueOnly === "true";
    const selectedMonth = parseMonthKey(req.query.month);

    const [maintenanceDocuments, clientMaintenanceVehicles, latamOrders] = await Promise.all([
      Maintenance.find({})
        .populate("client", "name email phone")
        .sort({ dueDate: 1 })
        .lean(),
      ClientMaintenanceVehicle.find({})
        .populate("user", "name email phone")
        .populate("client", "name email phone")
        .sort({ createdAt: -1 }),
      canAccessLatamOrders(req.user)
        ? Order.find({ status: "completed" })
          .populate("client", "name email phone")
          .sort({ updatedAt: -1 })
        : Promise.resolve([]),
    ]);

    const now = new Date();
    const nowUtcNoon = toUtcNoon(now) || now;
    const maintenanceByOrderId = new Map(
      maintenanceDocuments
        .filter((item) => item.order)
        .map((item) => [String(item.order || "").trim(), item])
    );

    const orderMaintenanceRows = latamOrders
      .map((order) => mapOrderMaintenanceRow(order, maintenanceByOrderId.get(String(order?._id || "").trim()) || null))
      .filter(Boolean);

    const coveredOrderIds = new Set(
      orderMaintenanceRows.map((item) => String(item.order?._id || item.order?.id || "").trim()).filter(Boolean)
    );

    const manualMaintenanceRows = maintenanceDocuments
      .filter((item) => String(item.source || "").trim() === "manual" || !item.order)
      .map(mapManualMaintenanceRow)
      .filter(Boolean)
      .filter((item) => {
        const orderId = String(item.order?._id || item.order?.id || "").trim();
        return !orderId || !coveredOrderIds.has(orderId);
      });

    const registeredOrderMaintenance = [...orderMaintenanceRows, ...manualMaintenanceRows]
      .sort((left, right) => new Date(left.dueDate || 0).getTime() - new Date(right.dueDate || 0).getTime());

    const filteredMaintenance = dueOnly
      ? registeredOrderMaintenance.filter((item) => item.dueDate <= now && ["scheduled", "due", "contacted", "sin_programar"].includes(item.status))
      : registeredOrderMaintenance;

    const monthFilteredMaintenance = selectedMonth
      ? filteredMaintenance.filter((item) => buildMonthKey(item.dueDate) === selectedMonth.key)
      : filteredMaintenance;

    const vehiclesWithScheduleDate = clientMaintenanceVehicles
      .map((vehicle) => {
        const lastMaintenanceDate = new Date(vehicle.lastPreventiveMaintenanceDate);
        const dueDateBySchedule = addMonthsLocal(lastMaintenanceDate, CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS);

        if (!dueDateBySchedule) {
          return null;
        }

        return {
          ...vehicle.toObject(),
          dueDateBySchedule,
        };
      })
      .filter(Boolean);

    const nextMonthReferenceDate = addMonthsLocal(now, 1);

    const orderDueThisMonth = registeredOrderMaintenance.filter((item) => isSameMonthAndYear(toUtcNoon(item.dueDate), nowUtcNoon));
    const orderDueNextMonth = registeredOrderMaintenance.filter((item) => {
      const dueDate = toUtcNoon(item.dueDate);
      return dueDate && isSameMonthAndYear(dueDate, nextMonthReferenceDate);
    });

    const dueByDateThisMonth = [
      ...vehiclesWithScheduleDate.filter((vehicle) => isWithinDaysRange(now, vehicle.dueDateBySchedule, 15)),
      ...orderDueThisMonth.map((item) => ({
        _id: item.maintenanceId || item.order?._id,
        brand: item.vehicleSnapshot?.brand || item.order?.vehicle?.brand || "",
        model: item.vehicleSnapshot?.model || item.order?.vehicle?.model || "",
        version: item.vehicleSnapshot?.version || item.order?.vehicle?.version || "",
        plate: item.vehicleSnapshot?.plate || item.order?.vehicle?.plate || item.order?.trackingNumber || "",
        year: item.vehicleSnapshot?.year || item.order?.vehicle?.year || null,
        usualDailyKm: null,
        currentMileage: item.reportedMileage,
        lastPreventiveMaintenanceDate: item.activationDate,
        dueDateBySchedule: item.dueDate,
        client: item.client,
        user: null,
        source: item.source,
      })),
    ];

    const dueByDateNextMonth = [
      ...vehiclesWithScheduleDate.filter((vehicle) => isWithinDaysRange(nextMonthReferenceDate, vehicle.dueDateBySchedule, 15)),
      ...orderDueNextMonth.map((item) => ({
        _id: item.maintenanceId || item.order?._id,
        brand: item.vehicleSnapshot?.brand || item.order?.vehicle?.brand || "",
        model: item.vehicleSnapshot?.model || item.order?.vehicle?.model || "",
        version: item.vehicleSnapshot?.version || item.order?.vehicle?.version || "",
        plate: item.vehicleSnapshot?.plate || item.order?.vehicle?.plate || item.order?.trackingNumber || "",
        year: item.vehicleSnapshot?.year || item.order?.vehicle?.year || null,
        usualDailyKm: null,
        currentMileage: item.reportedMileage,
        lastPreventiveMaintenanceDate: item.activationDate,
        dueDateBySchedule: item.dueDate,
        client: item.client,
        user: null,
        source: item.source,
      })),
    ];

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

    const appointmentScheduledThisMonth = clientMaintenanceVehicles
      .map((vehicle) => {
        if (vehicle.adminContactStatus !== "appointment_scheduled") {
          return null;
        }

        const appointmentDateSource = vehicle.adminAppointmentDate || vehicle.adminLastContactAt;
        const appointmentDate = toUtcNoon(appointmentDateSource);

        if (!appointmentDate) {
          return null;
        }

        if (!isSameMonthAndYear(appointmentDate, nowUtcNoon)) {
          return null;
        }

        return {
          ...vehicle.toObject(),
          appointmentDate,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftDateTime = `${new Date(left.appointmentDate).toISOString().slice(0, 10)}T${left.adminAppointmentTime || "23:59"}:00.000Z`;
        const rightDateTime = `${new Date(right.appointmentDate).toISOString().slice(0, 10)}T${right.adminAppointmentTime || "23:59"}:00.000Z`;
        return new Date(leftDateTime).getTime() - new Date(rightDateTime).getTime();
      });

    const scheduledCallsByMonth = buildMonthSummary(registeredOrderMaintenance);

    return res.status(200).json({
      maintenance: monthFilteredMaintenance,
      maintenanceTotal: filteredMaintenance.length,
      selectedMonth: selectedMonth
        ? {
          key: selectedMonth.key,
          year: selectedMonth.year,
          month: selectedMonth.monthIndex + 1,
          label: formatMonthLabel(selectedMonth.year, selectedMonth.monthIndex),
          count: monthFilteredMaintenance.length,
        }
        : null,
      scheduledCallsByMonth,
      clientMaintenanceVehicles,
      dueByDateThisMonth,
      dueByDateNextMonth,
      dueByMileageReached,
      appointmentScheduledThisMonth,
      cycleMonths: CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error fetching maintenance schedules" });
  }
}

async function createManualMaintenance(req, res) {
  try {
    if (!canAccessLatamOrders(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const brand = String(req.body.brand || "").trim();
    const model = String(req.body.model || "").trim();
    const version = String(req.body.version || "").trim();
    const vin = String(req.body.vin || "").trim().toUpperCase();
    const plate = String(req.body.plate || "").trim().toUpperCase();
    const contactName = String(req.body.contactName || req.body.clientName || "").trim();
    const contactPhone = String(req.body.contactPhone || req.body.clientPhone || "").trim();
    const contactEmail = String(req.body.contactEmail || req.body.clientEmail || "").trim().toLowerCase();
    const contactNotes = String(req.body.contactNotes || "").trim();
    const yearValue = req.body.year === "" || req.body.year === undefined || req.body.year === null
      ? null
      : Number(req.body.year);
    const activationDate = toUtcNoon(req.body.activationDate || req.body.deliveryDate);
    let dueDate = toUtcNoon(req.body.dueDate || req.body.nextMaintenanceDate);

    if (!brand || !model) {
      return res.status(400).json({ message: "Marca y modelo son obligatorios" });
    }

    if (!contactName) {
      return res.status(400).json({ message: "El nombre del cliente es obligatorio" });
    }

    if (!dueDate && activationDate) {
      dueDate = resolveMaintenanceDueDate(activationDate);
    }

    if (!dueDate) {
      return res.status(400).json({
        message: "Indica la fecha del próximo mantenimiento o la fecha de entrega/activación",
      });
    }

    if (yearValue !== null && (!Number.isInteger(yearValue) || yearValue < 1900 || yearValue > 2100)) {
      return res.status(400).json({ message: "Año de vehículo inválido" });
    }

    const maintenance = await Maintenance.create({
      order: null,
      client: null,
      createdBy: req.user._id,
      source: "manual",
      activationDate: activationDate || null,
      dueDate,
      status: resolveMaintenanceStatus(dueDate),
      vehicleSnapshot: {
        brand,
        model,
        version,
        year: yearValue,
        vin,
        plate,
      },
      contactName,
      contactPhone,
      contactEmail,
      contactNotes,
    });

    return res.status(201).json({
      message: "Mantenimiento creado correctamente",
      maintenance: mapManualMaintenanceRow(maintenance.toObject()),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error creating maintenance" });
  }
}

async function backfillMaintenance(req, res) {
  try {
    if (!canAccessLatamOrders(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const summary = await backfillCompletedOrderMaintenance(req.user._id);

    return res.status(200).json({
      message: "Pedidos completados sincronizados en mantenimientos",
      summary,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error backfilling maintenance" });
  }
}

async function updateMaintenance(req, res) {
  try {
    const { maintenanceId } = req.params;
    const { status, contactNotes, lastNotificationAt, completedAt, dueDate } = req.body;
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

    if (dueDate !== undefined) {
      const parsedDueDate = toUtcNoon(dueDate);

      if (!parsedDueDate) {
        return res.status(400).json({ message: "Invalid due date" });
      }

      maintenance.dueDate = parsedDueDate;
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
    const {
      adminContactStatus,
      adminContactNotes,
      adminAppointmentDate,
      adminAppointmentTime,
    } = req.body;

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

    if (adminAppointmentDate !== undefined) {
      if (adminAppointmentDate === null || adminAppointmentDate === "") {
        vehicle.adminAppointmentDate = null;
      } else {
        const parsedAppointmentDate = toUtcNoon(adminAppointmentDate);

        if (!parsedAppointmentDate) {
          return res.status(400).json({ message: "Invalid appointment date" });
        }

        vehicle.adminAppointmentDate = parsedAppointmentDate;
      }
    }

    if (adminAppointmentTime !== undefined) {
      if (adminAppointmentTime === null || adminAppointmentTime === "") {
        vehicle.adminAppointmentTime = "";
      } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(adminAppointmentTime))) {
        return res.status(400).json({ message: "Invalid appointment time" });
      } else {
        vehicle.adminAppointmentTime = String(adminAppointmentTime);
      }
    }

    if (vehicle.adminContactStatus === "appointment_scheduled" && !vehicle.adminAppointmentDate) {
      vehicle.adminAppointmentDate = toUtcNoon(new Date());
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
  createManualMaintenance,
  backfillMaintenance,
  updateMaintenance,
  updateClientMaintenanceVehicle,
};
