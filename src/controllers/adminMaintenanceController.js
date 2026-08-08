const Maintenance = require("../models/Maintenance");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const CotizadorMarketingLead = require("../models/CotizadorMarketingLead");
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
const {
  createAdminNotification,
  LATAM_ROLES,
} = require("../services/adminNotifications.service");

function parseDateBoundary(value, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const [year, month, day] = raw.split("-").map(Number);
  if (endOfDay) {
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function isDateInRange(dateValue, fromDate, toDate) {
  const date = toUtcNoon(dateValue);
  if (!date) {
    return false;
  }
  if (fromDate && date < fromDate) {
    return false;
  }
  if (toDate && date > toDate) {
    return false;
  }
  return true;
}

function mapMarketingLeadRow(lead) {
  const vehicleLabel = String(lead.vehicleLabel || "").trim();
  const [brand = "", model = ""] = vehicleLabel.split(/\s+/);
  const leadSource = String(lead.source || "").trim().toLowerCase();
  const fromWorkshop = leadSource === "taller" || leadSource === "mechanic" || leadSource === "workshop";
  const fromApp = leadSource === "app_mantenimiento" || leadSource === "cliente_app" || leadSource === "app";
  return {
    id: String(lead._id),
    source: fromApp ? "app_mantenimiento_marketing" : fromWorkshop ? "taller_marketing" : "cotizador_marketing",
    status: "scheduled",
    contactName: lead.name || "",
    contactPhone: lead.phone || "",
    contactEmail: lead.email || "",
    client: {
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
    },
    vehicleSnapshot: {
      brand: brand || vehicleLabel || (fromApp ? "App" : fromWorkshop ? "Taller" : "Cotización"),
      model: model || "",
      version: vehicleLabel,
      vin: lead.identification || "",
    },
    activationDate: lead.createdAt || null,
    dueDate: lead.followUpAt || null,
    order: null,
    marketingLeadId: String(lead._id),
  };
}

const ALLOWED_ADMIN_CONTACT_STATUSES = [
  "pending",
  "contacted",
  "will_service",
  "serviced_elsewhere",
  "not_interested",
  "appointment_scheduled",
];

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
    adminContactStatus: maintenanceRecord?.adminContactStatus || "pending",
    adminAppointmentDate: maintenanceRecord?.adminAppointmentDate || null,
    adminAppointmentTime: maintenanceRecord?.adminAppointmentTime || "",
    adminLastContactAt: maintenanceRecord?.adminLastContactAt || null,
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

function resolveMaintenanceContactClient(item) {
  const contactName = String(item?.contactName || "").trim();
  const contactPhone = String(item?.contactPhone || "").trim();
  const contactEmail = String(item?.contactEmail || "").trim();
  const existingClient = item?.client && typeof item.client === "object" ? item.client : null;

  if (existingClient && (existingClient.name || existingClient.phone || existingClient.email)) {
    return {
      ...existingClient,
      name: existingClient.name || contactName || "",
      phone: existingClient.phone || contactPhone || "",
      email: existingClient.email || contactEmail || "",
    };
  }

  if (contactName || contactPhone || contactEmail) {
    return {
      name: contactName,
      phone: contactPhone,
      email: contactEmail,
    };
  }

  return existingClient;
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
    client: resolveMaintenanceContactClient(maintenanceRecord),
    createdAt: maintenanceRecord?.createdAt || null,
    activationDate: toUtcNoon(maintenanceRecord?.activationDate),
    dueDate,
    status: resolveMaintenanceStatus(dueDate, maintenanceRecord?.status),
    reportedMileage: maintenanceRecord?.reportedMileage ?? null,
    clientNotes: maintenanceRecord?.clientNotes || "",
    contactNotes: maintenanceRecord?.contactNotes || "",
    contactName: maintenanceRecord?.contactName || "",
    contactPhone: maintenanceRecord?.contactPhone || "",
    contactEmail: maintenanceRecord?.contactEmail || "",
    adminContactStatus: maintenanceRecord?.adminContactStatus || "pending",
    adminAppointmentDate: maintenanceRecord?.adminAppointmentDate || null,
    adminAppointmentTime: maintenanceRecord?.adminAppointmentTime || "",
    adminLastContactAt: maintenanceRecord?.adminLastContactAt || null,
    vehicleSnapshot: maintenanceRecord?.vehicleSnapshot || {},
  };
}

function mapOrderMaintenanceToContactVehicle(item) {
  const client = resolveMaintenanceContactClient(item);

  return {
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
    client,
    contactName: item.contactName || client?.name || "",
    contactPhone: item.contactPhone || client?.phone || "",
    contactEmail: item.contactEmail || client?.email || "",
    user: null,
    source: item.source,
    recordType: "maintenance",
    adminContactStatus: item.adminContactStatus || "pending",
    adminContactNotes: item.contactNotes || "",
    adminAppointmentDate: item.adminAppointmentDate || null,
    adminAppointmentTime: item.adminAppointmentTime || "",
    adminLastContactAt: item.adminLastContactAt || null,
  };
}

function mapMaintenanceDocumentToContactVehicle(maintenance) {
  const plain = maintenance.toObject ? maintenance.toObject() : maintenance;
  const order = plain.order && typeof plain.order === "object" ? plain.order : null;
  const snap = plain.vehicleSnapshot || {};
  const client = resolveMaintenanceContactClient(plain);

  return {
    _id: plain._id,
    brand: snap.brand || order?.vehicle?.brand || "",
    model: snap.model || order?.vehicle?.model || "",
    version: snap.version || order?.vehicle?.version || "",
    plate: snap.plate || order?.vehicle?.plate || order?.trackingNumber || "",
    year: snap.year || order?.vehicle?.year || null,
    usualDailyKm: null,
    currentMileage: plain.reportedMileage ?? null,
    lastPreventiveMaintenanceDate: plain.activationDate || null,
    dueDateBySchedule: plain.dueDate || null,
    client,
    contactName: plain.contactName || client?.name || "",
    contactPhone: plain.contactPhone || client?.phone || "",
    contactEmail: plain.contactEmail || client?.email || "",
    user: null,
    source: plain.source || (order ? "order" : "manual"),
    recordType: "maintenance",
    adminContactStatus: plain.adminContactStatus || "pending",
    adminContactNotes: plain.contactNotes || "",
    adminAppointmentDate: plain.adminAppointmentDate || null,
    adminAppointmentTime: plain.adminAppointmentTime || "",
    adminLastContactAt: plain.adminLastContactAt || null,
  };
}

function applyAdminContactFields(target, {
  adminContactStatus,
  adminContactNotes,
  adminAppointmentDate,
  adminAppointmentTime,
  notesField = "adminContactNotes",
}) {
  if (adminContactStatus !== undefined) {
    if (!ALLOWED_ADMIN_CONTACT_STATUSES.includes(adminContactStatus)) {
      return { error: { status: 400, message: "Invalid contact status" } };
    }

    target.adminContactStatus = adminContactStatus;
  }

  if (typeof adminContactNotes === "string") {
    target[notesField] = adminContactNotes.trim();
  }

  if (adminAppointmentDate !== undefined) {
    if (adminAppointmentDate === null || adminAppointmentDate === "") {
      target.adminAppointmentDate = null;
    } else {
      const parsedAppointmentDate = toUtcNoon(adminAppointmentDate);

      if (!parsedAppointmentDate) {
        return { error: { status: 400, message: "Invalid appointment date" } };
      }

      target.adminAppointmentDate = parsedAppointmentDate;
    }
  }

  if (adminAppointmentTime !== undefined) {
    if (adminAppointmentTime === null || adminAppointmentTime === "") {
      target.adminAppointmentTime = "";
    } else if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(adminAppointmentTime))) {
      return { error: { status: 400, message: "Invalid appointment time" } };
    } else {
      target.adminAppointmentTime = String(adminAppointmentTime);
    }
  }

  if (target.adminContactStatus === "appointment_scheduled" && !target.adminAppointmentDate) {
    target.adminAppointmentDate = toUtcNoon(new Date());
  }

  target.adminLastContactAt = new Date();
  return { error: null };
}

async function listMaintenance(req, res) {
  try {
    const dueOnly = req.query.dueOnly === "true";
    const selectedMonth = parseMonthKey(req.query.month);
    const fromDate = parseDateBoundary(req.query.from, false);
    const toDate = parseDateBoundary(req.query.to, true);
    const hasDateRange = Boolean(fromDate || toDate);

    const [maintenanceDocuments, clientMaintenanceVehicles, latamOrders, marketingLeads] = await Promise.all([
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
      CotizadorMarketingLead.find({})
        .sort({ followUpAt: 1 })
        .lean(),
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

    const marketingLeadRows = marketingLeads.map(mapMarketingLeadRow).filter((item) => item.dueDate);

    const registeredOrderMaintenance = [...orderMaintenanceRows, ...manualMaintenanceRows, ...marketingLeadRows]
      .sort((left, right) => new Date(left.dueDate || 0).getTime() - new Date(right.dueDate || 0).getTime());

    const filteredMaintenance = dueOnly
      ? registeredOrderMaintenance.filter((item) => item.dueDate <= now && ["scheduled", "due", "contacted", "sin_programar"].includes(item.status))
      : registeredOrderMaintenance;

    let monthFilteredMaintenance = selectedMonth
      ? filteredMaintenance.filter((item) => buildMonthKey(item.dueDate) === selectedMonth.key)
      : filteredMaintenance;

    if (hasDateRange) {
      monthFilteredMaintenance = filteredMaintenance.filter((item) => isDateInRange(item.dueDate, fromDate, toDate));
    }

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

    // Manuales recién añadidos (o con entrega este mes) deben poder agendarse aunque el
    // vencimiento preventivo (+6 meses) caiga en otro mes.
    const pendingManualNeedsAttentionThisMonth = (item) => {
      if (String(item.source || "").trim() !== "manual") {
        return false;
      }

      if (String(item.adminContactStatus || "pending").trim() !== "pending") {
        return false;
      }

      const createdAt = toUtcNoon(item.createdAt);
      const activationDate = toUtcNoon(item.activationDate);

      return Boolean(
        (createdAt && isSameMonthAndYear(createdAt, nowUtcNoon))
        || (activationDate && isSameMonthAndYear(activationDate, nowUtcNoon))
      );
    };

    const orderDueThisMonth = registeredOrderMaintenance.filter((item) => {
      const dueDate = toUtcNoon(item.dueDate);
      return (dueDate && isSameMonthAndYear(dueDate, nowUtcNoon))
        || pendingManualNeedsAttentionThisMonth(item);
    });
    const orderDueNextMonth = registeredOrderMaintenance.filter((item) => {
      const dueDate = toUtcNoon(item.dueDate);
      return dueDate && isSameMonthAndYear(dueDate, nextMonthReferenceDate);
    });

    const dueByDateThisMonthIds = new Set();
    const dueByDateThisMonth = [
      ...vehiclesWithScheduleDate.filter((vehicle) => isWithinDaysRange(now, vehicle.dueDateBySchedule, 15)),
      ...orderDueThisMonth
        .map(mapOrderMaintenanceToContactVehicle)
        .filter((vehicle) => {
          const id = String(vehicle?._id || "").trim();
          if (!id || dueByDateThisMonthIds.has(id)) {
            return false;
          }
          dueByDateThisMonthIds.add(id);
          return true;
        }),
    ];

    const dueByDateNextMonth = [
      ...vehiclesWithScheduleDate.filter((vehicle) => isWithinDaysRange(nextMonthReferenceDate, vehicle.dueDateBySchedule, 15)),
      ...orderDueNextMonth.map(mapOrderMaintenanceToContactVehicle),
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

    const appointmentScheduledFromClientVehicles = clientMaintenanceVehicles
      .map((vehicle) => {
        if (vehicle.adminContactStatus !== "appointment_scheduled") {
          return null;
        }

        const appointmentDateSource = vehicle.adminAppointmentDate || vehicle.adminLastContactAt;
        const appointmentDate = toUtcNoon(appointmentDateSource);

        if (!appointmentDate) {
          return null;
        }

        return {
          ...vehicle.toObject(),
          appointmentDate,
          recordType: "client_vehicle",
        };
      })
      .filter(Boolean);

    const appointmentScheduledFromOrders = registeredOrderMaintenance
      .filter((item) => item.adminContactStatus === "appointment_scheduled" && item.maintenanceId)
      .map((item) => {
        const appointmentDateSource = item.adminAppointmentDate || item.adminLastContactAt;
        const appointmentDate = toUtcNoon(appointmentDateSource);

        if (!appointmentDate) {
          return null;
        }

        return {
          ...mapOrderMaintenanceToContactVehicle(item),
          appointmentDate,
        };
      })
      .filter(Boolean);

    const appointmentScheduled = [...appointmentScheduledFromClientVehicles, ...appointmentScheduledFromOrders]
      .sort((left, right) => {
        const leftDateTime = `${new Date(left.appointmentDate).toISOString().slice(0, 10)}T${left.adminAppointmentTime || "23:59"}:00.000Z`;
        const rightDateTime = `${new Date(right.appointmentDate).toISOString().slice(0, 10)}T${right.adminAppointmentTime || "23:59"}:00.000Z`;
        return new Date(leftDateTime).getTime() - new Date(rightDateTime).getTime();
      });

    const appointmentScheduledThisMonth = appointmentScheduled.filter((vehicle) => (
      isSameMonthAndYear(toUtcNoon(vehicle.appointmentDate), nowUtcNoon)
    ));

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
      selectedDateRange: hasDateRange
        ? {
          from: req.query.from || null,
          to: req.query.to || null,
          count: monthFilteredMaintenance.length,
        }
        : null,
      scheduledCallsByMonth,
      clientMaintenanceVehicles,
      dueByDateThisMonth,
      dueByDateNextMonth,
      dueByMileageReached,
      appointmentScheduled,
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

    const previousStatus = String(maintenance.status || "");

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

    if (previousStatus !== "completed" && maintenance.status === "completed") {
      const clientName = maintenance.client?.name || "Cliente";
      const vehicleLabel = [
        maintenance.order?.vehicle?.brand,
        maintenance.order?.vehicle?.model,
      ].filter(Boolean).join(" ") || "Mantenimiento";

      await createAdminNotification({
        type: "maintenance_completed",
        title: "Mantenimiento finalizado",
        body: `${clientName} · ${vehicleLabel}`,
        deepLink: "/admin-maintenance.html",
        entityModel: "Maintenance",
        entityId: maintenance._id,
        createdBy: req.user?._id || null,
        audienceRoles: LATAM_ROLES,
      });
    }

    return res.status(200).json({
      message: "Maintenance updated successfully",
      maintenance,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating maintenance" });
  }
}

async function updateClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const {
      adminContactStatus,
      adminContactNotes,
      adminAppointmentDate,
      adminAppointmentTime,
    } = req.body;

    const contactPayload = {
      adminContactStatus,
      adminContactNotes,
      adminAppointmentDate,
      adminAppointmentTime,
    };

    const vehicle = await ClientMaintenanceVehicle.findById(vehicleId)
      .populate("user", "name email phone")
      .populate("client", "name email phone");

    if (vehicle) {
      const previousContactStatus = String(vehicle.adminContactStatus || "");
      const applied = applyAdminContactFields(vehicle, contactPayload);

      if (applied.error) {
        return res.status(applied.error.status).json({ message: applied.error.message });
      }

      await vehicle.save();

      if (
        previousContactStatus !== "appointment_scheduled" &&
        vehicle.adminContactStatus === "appointment_scheduled"
      ) {
        const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
        const vehicleLabel = [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "Vehículo";
        await createAdminNotification({
          type: "maintenance_appointment",
          title: "Cita de mantenimiento agendada",
          body: `${ownerName} · ${vehicleLabel}`,
          deepLink: "/admin-maintenance.html",
          entityModel: "ClientMaintenanceVehicle",
          entityId: vehicle._id,
          createdBy: req.user?._id || null,
          audienceRoles: LATAM_ROLES,
        });
      }

      return res.status(200).json({
        message: "Vehicle contact info updated",
        vehicle,
      });
    }

    // Rows from "Este mes / Próximo mes" can use Maintenance IDs (order/manual preventivos),
    // or occasionally the Order ID when no maintenance document was linked yet.
    let maintenance = await Maintenance.findById(vehicleId)
      .populate("client", "name email phone")
      .populate("order");

    if (!maintenance) {
      maintenance = await Maintenance.findOne({ order: vehicleId })
        .populate("client", "name email phone")
        .populate("order");
    }

    if (!maintenance) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    const previousContactStatus = String(maintenance.adminContactStatus || "");
    const appliedMaintenance = applyAdminContactFields(maintenance, {
      ...contactPayload,
      notesField: "contactNotes",
    });

    if (appliedMaintenance.error) {
      return res.status(appliedMaintenance.error.status).json({ message: appliedMaintenance.error.message });
    }

    if (maintenance.adminContactStatus === "contacted" || maintenance.adminContactStatus === "appointment_scheduled") {
      if (maintenance.status === "scheduled" || maintenance.status === "due") {
        maintenance.status = "contacted";
      }
    }

    await maintenance.save();

    if (
      previousContactStatus !== "appointment_scheduled" &&
      maintenance.adminContactStatus === "appointment_scheduled"
    ) {
      const mappedVehicle = mapMaintenanceDocumentToContactVehicle(maintenance);
      const ownerName = mappedVehicle.client?.name || mappedVehicle.contactName || "Cliente";
      const vehicleLabel = [mappedVehicle.brand, mappedVehicle.model].filter(Boolean).join(" ") || "Vehículo";
      await createAdminNotification({
        type: "maintenance_appointment",
        title: "Cita de mantenimiento agendada",
        body: `${ownerName} · ${vehicleLabel}`,
        deepLink: "/admin-maintenance.html",
        entityModel: "Maintenance",
        entityId: maintenance._id,
        createdBy: req.user?._id || null,
        audienceRoles: LATAM_ROLES,
      });
    }

    return res.status(200).json({
      message: "Vehicle contact info updated",
      vehicle: mapMaintenanceDocumentToContactVehicle(maintenance),
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
