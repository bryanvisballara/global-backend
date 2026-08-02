const ShowroomVisit = require("../models/ShowroomVisit");
const {
  createAdminNotification,
  LATAM_ROLES,
} = require("../services/adminNotifications.service");
const { toUtcNoon } = require("../services/maintenanceScheduleService");

const BUSINESS_TIMEZONE = "America/Bogota";

function canAccessLatam(user) {
  return ["admin", "manager"].includes(String(user?.role || ""));
}

function toBusinessDayKey(dateValue, timeZone = BUSINESS_TIMEZONE) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function toBusinessNoon(dateValue) {
  const key = typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? dateValue
    : toBusinessDayKey(dateValue);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function serializeVisit(visit) {
  const plain = visit.toObject ? visit.toObject() : visit;
  return {
    id: String(plain._id),
    visitorName: plain.visitorName || "",
    visitorPhone: plain.visitorPhone || "",
    visitorEmail: plain.visitorEmail || "",
    visitorDocument: plain.visitorDocument || "",
    visitDate: plain.visitDate || null,
    visitTime: plain.visitTime || "",
    agendaDayKey: toBusinessDayKey(plain.visitDate),
    purpose: plain.purpose || "showroom",
    vehicleInterest: plain.vehicleInterest || {},
    notes: plain.notes || "",
    status: plain.status || "scheduled",
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

async function listVisits(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }
    const visits = await ShowroomVisit.find({})
      .sort({ visitDate: 1, visitTime: 1, createdAt: -1 })
      .limit(300)
      .lean();
    return res.status(200).json({ visits: visits.map(serializeVisit) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error listing visits" });
  }
}

async function createVisit(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const visitorName = String(req.body.visitorName || "").trim();
    const visitDateRaw = String(req.body.visitDate || "").trim();
    if (!visitorName || !visitDateRaw) {
      return res.status(400).json({ message: "Indica nombre del visitante y fecha" });
    }

    const visitDate = toBusinessNoon(visitDateRaw) || toUtcNoon(visitDateRaw);
    if (!visitDate) {
      return res.status(400).json({ message: "Fecha de visita inválida" });
    }

    const visit = await ShowroomVisit.create({
      visitorName,
      visitorPhone: String(req.body.visitorPhone || "").trim(),
      visitorEmail: String(req.body.visitorEmail || "").trim().toLowerCase(),
      visitorDocument: String(req.body.visitorDocument || "").trim(),
      visitDate,
      visitTime: String(req.body.visitTime || "").trim().slice(0, 5),
      purpose: ["showroom", "delivery", "pickup", "other"].includes(String(req.body.purpose || ""))
        ? String(req.body.purpose)
        : "showroom",
      vehicleInterest: {
        brand: String(req.body.brand || "").trim(),
        model: String(req.body.model || "").trim(),
        year: String(req.body.year || "").trim(),
        version: String(req.body.version || "").trim(),
      },
      notes: String(req.body.notes || "").trim().slice(0, 2000),
      status: "scheduled",
      createdBy: req.user._id,
    });

    await createAdminNotification({
      type: "visitor_created",
      title: "Nuevo visitante registrado",
      body: `${visitorName} · cita agendada`,
      deepLink: "/admin-visitors.html",
      entityModel: "ShowroomVisit",
      entityId: visit._id,
      createdBy: req.user._id,
      audienceRoles: LATAM_ROLES,
    });

    return res.status(201).json({
      message: "Visita registrada",
      visit: serializeVisit(visit),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error creating visit" });
  }
}

async function updateVisit(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const visit = await ShowroomVisit.findById(req.params.visitId);
    if (!visit) {
      return res.status(404).json({ message: "Visita no encontrada" });
    }

    if (req.body.visitorName != null) visit.visitorName = String(req.body.visitorName || "").trim();
    if (req.body.visitorPhone != null) visit.visitorPhone = String(req.body.visitorPhone || "").trim();
    if (req.body.visitorEmail != null) visit.visitorEmail = String(req.body.visitorEmail || "").trim().toLowerCase();
    if (req.body.visitorDocument != null) visit.visitorDocument = String(req.body.visitorDocument || "").trim();
    if (req.body.visitTime != null) visit.visitTime = String(req.body.visitTime || "").trim().slice(0, 5);
    if (req.body.notes != null) visit.notes = String(req.body.notes || "").trim().slice(0, 2000);
    if (req.body.purpose != null && ["showroom", "delivery", "pickup", "other"].includes(String(req.body.purpose))) {
      visit.purpose = String(req.body.purpose);
    }
    if (req.body.status != null && ["scheduled", "completed", "cancelled", "no_show"].includes(String(req.body.status))) {
      visit.status = String(req.body.status);
    }
    if (req.body.visitDate) {
      const nextDate = toBusinessNoon(String(req.body.visitDate).trim());
      if (nextDate) visit.visitDate = nextDate;
    }
    visit.vehicleInterest = {
      brand: String(req.body.brand ?? visit.vehicleInterest?.brand ?? "").trim(),
      model: String(req.body.model ?? visit.vehicleInterest?.model ?? "").trim(),
      year: String(req.body.year ?? visit.vehicleInterest?.year ?? "").trim(),
      version: String(req.body.version ?? visit.vehicleInterest?.version ?? "").trim(),
    };

    if (!visit.visitorName) {
      return res.status(400).json({ message: "El nombre del visitante es obligatorio" });
    }

    await visit.save();
    return res.status(200).json({
      message: "Visita actualizada",
      visit: serializeVisit(visit),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating visit" });
  }
}

async function deleteVisit(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }
    const visit = await ShowroomVisit.findByIdAndDelete(req.params.visitId);
    if (!visit) {
      return res.status(404).json({ message: "Visita no encontrada" });
    }
    return res.status(200).json({ message: "Visita eliminada" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting visit" });
  }
}

module.exports = {
  listVisits,
  createVisit,
  updateVisit,
  deleteVisit,
  serializeVisit,
  toBusinessDayKey,
  toBusinessNoon,
};
