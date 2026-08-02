const path = require("path");
const fs = require("fs");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const Maintenance = require("../models/Maintenance");
const ShowroomVisit = require("../models/ShowroomVisit");
const VehicleGateReport = require("../models/VehicleGateReport");
const { toUtcNoon } = require("../services/maintenanceScheduleService");
const { uploadBufferToCloudinary, isCloudinaryConfigured } = require("../config/cloudinary");
const {
  serializeVisit,
  toBusinessDayKey,
  toBusinessNoon,
} = require("./adminVisitorsController");

const ACCESSORY_CATALOG = [
  ["main_key", "Llave principal"],
  ["spare_key", "Llave de repuesto"],
  ["alarm", "Control / alarma"],
  ["tools", "Kit de herramientas"],
  ["jack", "Gato / crique"],
  ["extinguisher", "Extintor"],
  ["mats", "Tapetes"],
  ["roof_bars", "Barras de techo"],
  ["tow_hook", "Gancho de remolque"],
  ["charger", "Cables / cargador"],
  ["spare_tire", "Llanta de repuesto"],
  ["triangle", "Triángulo"],
  ["first_aid", "Botiquín"],
  ["other", "Otros"],
];

function canAccessVigilance(user) {
  return ["vigilance", "admin", "manager"].includes(String(user?.role || ""));
}

function resolveClientName(item = {}) {
  return String(
    item.clientName
    || item.contactName
    || item.user?.name
    || item.client?.name
    || ""
  ).trim();
}

function serializeAppointmentVehicle(item, recordType) {
  return {
    id: String(item._id || ""),
    kind: "maintenance",
    recordType,
    clientName: resolveClientName(item),
    brand: item.brand || item.vehicleSnapshot?.brand || "",
    model: item.model || item.vehicleSnapshot?.model || "",
    version: item.version || item.vehicleSnapshot?.version || "",
    year: item.year || item.vehicleSnapshot?.year || "",
    plate: item.plate || item.vehicleSnapshot?.plate || "",
    appointmentDate: item.adminAppointmentDate || null,
    appointmentTime: item.adminAppointmentTime || "",
    agendaDayKey: toBusinessDayKey(item.adminAppointmentDate),
  };
}

async function listMaintenanceAppointments() {
  const [clientVehicles, maintenanceDocs] = await Promise.all([
    ClientMaintenanceVehicle.find({ adminContactStatus: "appointment_scheduled" })
      .select("brand model version year plate adminAppointmentDate adminAppointmentTime user client")
      .populate("user", "name")
      .populate("client", "name")
      .lean(),
    Maintenance.find({ adminContactStatus: "appointment_scheduled" })
      .select("vehicleSnapshot adminAppointmentDate adminAppointmentTime contactName client")
      .populate("client", "name")
      .lean(),
  ]);

  const fromClient = clientVehicles
    .filter((item) => item.adminAppointmentDate)
    .map((item) => serializeAppointmentVehicle(item, "client_vehicle"));

  const fromMaintenance = maintenanceDocs
    .filter((item) => item.adminAppointmentDate)
    .map((item) => serializeAppointmentVehicle({
      _id: item._id,
      brand: item.vehicleSnapshot?.brand,
      model: item.vehicleSnapshot?.model,
      version: item.vehicleSnapshot?.version,
      year: item.vehicleSnapshot?.year,
      plate: item.vehicleSnapshot?.plate,
      adminAppointmentDate: item.adminAppointmentDate,
      adminAppointmentTime: item.adminAppointmentTime,
      contactName: item.contactName,
      client: item.client,
    }, "maintenance"));

  return [...fromClient, ...fromMaintenance];
}

async function buildEntryNumber() {
  const seed = Date.now() % 900000;
  return `#GI-ING-${String(seed).padStart(6, "0")}`;
}

async function saveUploadedPhotos(files = [], folder = "mechanic-diagnosis") {
  const list = Array.isArray(files) ? files.slice(0, 12) : [];
  if (!list.length) return [];

  if (isCloudinaryConfigured()) {
    const uploaded = [];
    for (const file of list) {
      const result = await uploadBufferToCloudinary(file, `global-app/${folder}`);
      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id || "",
        name: file.originalname || "foto.jpg",
        note: "",
      });
    }
    return uploaded;
  }

  const uploadDir = path.join(__dirname, "..", "..", "uploads", folder);
  fs.mkdirSync(uploadDir, { recursive: true });
  const uploaded = [];
  for (const file of list) {
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || ".jpg")}`;
    fs.writeFileSync(path.join(uploadDir, safeName), file.buffer);
    uploaded.push({
      url: `/uploads/${folder}/${safeName}`,
      publicId: "",
      name: file.originalname || safeName,
      note: "",
    });
  }
  return uploaded;
}

async function saveSignatureDataUrl(dataUrl, folder = "gate-signatures") {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/")) return "";
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return "";
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > 1_500_000) return "";

  if (isCloudinaryConfigured()) {
    const result = await uploadBufferToCloudinary(
      { buffer, mimetype: mime, originalname: "firma.png" },
      `global-app/${folder}`
    );
    return result.secure_url || "";
  }

  const ext = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : ".png";
  const uploadDir = path.join(__dirname, "..", "..", "uploads", folder);
  fs.mkdirSync(uploadDir, { recursive: true });
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(uploadDir, safeName), buffer);
  return `/uploads/${folder}/${safeName}`;
}

function parseAccessories(body = {}) {
  let raw = body.accessories;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_error) {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) raw = [];
  const byKey = new Map(raw.map((item) => [String(item.key || "").trim(), item]));
  return ACCESSORY_CATALOG.map(([key, label]) => {
    const item = byKey.get(key) || {};
    return {
      key,
      label,
      present: Boolean(item.present),
      note: String(item.note || "").trim().slice(0, 240),
    };
  });
}

function parseDocuments(body = {}) {
  let docs = body.documentsReceived;
  if (typeof docs === "string") {
    try {
      docs = JSON.parse(docs);
    } catch (_error) {
      docs = docs.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(docs)) docs = [];
  return docs.map((item) => String(item || "").trim()).filter(Boolean);
}

function serializeGateReport(report) {
  const plain = report.toObject ? report.toObject() : report;
  return {
    id: String(plain._id),
    entryNumber: plain.entryNumber,
    status: plain.status,
    direction: plain.direction,
    entryDate: plain.entryDate,
    entryTime: plain.entryTime || "",
    exitDate: plain.exitDate,
    exitTime: plain.exitTime || "",
    shift: plain.shift || "",
    vehicle: plain.vehicle || {},
    documentsReceived: plain.documentsReceived || [],
    accessories: plain.accessories || [],
    entryObservations: plain.entryObservations || "",
    exitObservations: plain.exitObservations || "",
    generalObservations: plain.generalObservations || "",
    entryPhotos: plain.entryPhotos || [],
    exitPhotos: plain.exitPhotos || [],
    deliverer: plain.deliverer || {},
    securityReceiver: plain.securityReceiver || {},
    exitDeliverer: plain.exitDeliverer || {},
    exitReceiver: plain.exitReceiver || {},
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
    closedAt: plain.closedAt,
    agendaDayKey: toBusinessDayKey(plain.entryDate || plain.createdAt),
  };
}

async function getPortalOverview(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Portal disponible solo para vigilancia / LATAM admin" });
    }

    const todayKey = toBusinessDayKey(new Date());
    const [maintenanceAppointments, visits, openReports] = await Promise.all([
      listMaintenanceAppointments(),
      ShowroomVisit.find({ status: "scheduled" }).sort({ visitDate: 1, visitTime: 1 }).limit(200).lean(),
      VehicleGateReport.find({ status: "open" }).sort({ createdAt: -1 }).limit(40).lean(),
    ]);

    const visitorAppointments = visits.map((item) => ({
      ...serializeVisit(item),
      kind: "visitor",
    }));

    const agenda = [
      ...maintenanceAppointments.map((item) => ({ ...item, kind: "maintenance" })),
      ...visitorAppointments,
    ].sort((left, right) => {
      const leftKey = `${left.agendaDayKey || ""}T${left.appointmentTime || left.visitTime || "23:59"}`;
      const rightKey = `${right.agendaDayKey || ""}T${right.appointmentTime || right.visitTime || "23:59"}`;
      return leftKey.localeCompare(rightKey);
    });

    return res.status(200).json({
      todayKey,
      agenda,
      todayAgenda: agenda.filter((item) => (item.agendaDayKey || "") === todayKey),
      openReports: openReports.map(serializeGateReport),
      accessoryCatalog: ACCESSORY_CATALOG.map(([key, label]) => ({ key, label })),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading vigilance portal" });
  }
}

async function listGateReports(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const reports = await VehicleGateReport.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json({ reports: reports.map(serializeGateReport) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error listing gate reports" });
  }
}

async function getGateReport(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const report = await VehicleGateReport.findById(req.params.reportId);
    if (!report) {
      return res.status(404).json({ message: "Reporte no encontrado" });
    }
    return res.status(200).json({ report: serializeGateReport(report) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading report" });
  }
}

async function createEntryReport(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const plate = String(req.body.plate || "").trim().toUpperCase();
    const brand = String(req.body.brand || "").trim();
    const model = String(req.body.model || "").trim();
    if (!plate || !brand || !model) {
      return res.status(400).json({ message: "Completa placa, marca y modelo" });
    }

    const delivererName = String(req.body.delivererName || "").trim();
    const securityName = String(req.body.securityName || "").trim();
    if (!delivererName || !securityName) {
      return res.status(400).json({ message: "Indica quien entrega y quien recibe (seguridad)" });
    }

    const delivererSignature = await saveSignatureDataUrl(req.body.delivererSignatureDataUrl);
    const securitySignature = await saveSignatureDataUrl(req.body.securitySignatureDataUrl);
    if (!delivererSignature || !securitySignature) {
      return res.status(400).json({ message: "Se requieren ambas firmas de ingreso" });
    }

    const entryPhotos = await saveUploadedPhotos(req.files, "gate-reports");
    const entryDate = toBusinessNoon(req.body.entryDate || new Date()) || toUtcNoon(new Date());

    const report = await VehicleGateReport.create({
      entryNumber: await buildEntryNumber(),
      status: "open",
      direction: "entry",
      entryDate,
      entryTime: String(req.body.entryTime || "").trim().slice(0, 5),
      shift: ["morning", "afternoon", "night"].includes(String(req.body.shift || ""))
        ? String(req.body.shift)
        : "",
      vehicle: {
        plate,
        vin: String(req.body.vin || "").trim().toUpperCase(),
        brand,
        model,
        year: String(req.body.year || "").trim(),
        color: String(req.body.color || "").trim(),
        version: String(req.body.version || "").trim(),
        mileage: req.body.mileage === "" || req.body.mileage == null ? null : Number(req.body.mileage),
        fuelType: String(req.body.fuelType || "").trim(),
        arrivalMethod: String(req.body.arrivalMethod || "").trim(),
        departureMethod: "",
      },
      documentsReceived: parseDocuments(req.body),
      accessories: parseAccessories(req.body),
      entryObservations: String(req.body.entryObservations || "").trim().slice(0, 4000),
      generalObservations: String(req.body.generalObservations || "").trim().slice(0, 4000),
      entryPhotos,
      deliverer: {
        fullName: delivererName,
        documentId: String(req.body.delivererDocument || "").trim(),
        phone: String(req.body.delivererPhone || "").trim(),
        relationship: String(req.body.delivererRelationship || "").trim(),
        signatureUrl: delivererSignature,
      },
      securityReceiver: {
        fullName: securityName,
        documentId: String(req.body.securityDocument || "").trim(),
        phone: "",
        relationship: "security",
        signatureUrl: securitySignature,
      },
      createdBy: req.user._id,
    });

    return res.status(201).json({
      message: "Ingreso registrado",
      report: serializeGateReport(report),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error creating entry report" });
  }
}

async function createDirectExitReport(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const plate = String(req.body.plate || "").trim().toUpperCase();
    const brand = String(req.body.brand || "").trim();
    const model = String(req.body.model || "").trim();
    if (!plate || !brand || !model) {
      return res.status(400).json({ message: "Completa placa, marca y modelo" });
    }

    const exitDelivererName = String(req.body.exitDelivererName || "").trim();
    const exitReceiverName = String(req.body.exitReceiverName || "").trim();
    if (!exitDelivererName || !exitReceiverName) {
      return res.status(400).json({ message: "Indica responsables de entrega y recepción en salida" });
    }

    const exitDelivererSignature = await saveSignatureDataUrl(req.body.exitDelivererSignatureDataUrl);
    const exitReceiverSignature = await saveSignatureDataUrl(req.body.exitReceiverSignatureDataUrl);
    if (!exitDelivererSignature || !exitReceiverSignature) {
      return res.status(400).json({ message: "Se requieren ambas firmas de salida" });
    }

    const exitPhotos = await saveUploadedPhotos(req.files, "gate-reports");
    const exitDate = toBusinessNoon(req.body.exitDate || new Date()) || toUtcNoon(new Date());

    const report = await VehicleGateReport.create({
      entryNumber: await buildEntryNumber(),
      status: "closed",
      direction: "exit",
      exitDate,
      exitTime: String(req.body.exitTime || "").trim().slice(0, 5),
      shift: ["morning", "afternoon", "night"].includes(String(req.body.shift || ""))
        ? String(req.body.shift)
        : "",
      exitObservations: String(req.body.exitObservations || "").trim().slice(0, 4000),
      generalObservations: String(req.body.generalObservations || "").trim().slice(0, 4000),
      vehicle: {
        plate,
        vin: String(req.body.vin || "").trim().toUpperCase(),
        brand,
        model,
        year: String(req.body.year || "").trim(),
        color: String(req.body.color || "").trim(),
        version: String(req.body.version || "").trim(),
        mileage: req.body.mileage === "" || req.body.mileage == null ? null : Number(req.body.mileage),
        fuelType: "",
        arrivalMethod: "",
        departureMethod: String(req.body.departureMethod || "").trim(),
      },
      documentsReceived: parseDocuments(req.body),
      accessories: parseAccessories(req.body),
      exitPhotos,
      exitDeliverer: {
        fullName: exitDelivererName,
        documentId: String(req.body.exitDelivererDocument || "").trim(),
        phone: String(req.body.exitDelivererPhone || "").trim(),
        relationship: String(req.body.exitDelivererRelationship || "").trim(),
        signatureUrl: exitDelivererSignature,
      },
      exitReceiver: {
        fullName: exitReceiverName,
        documentId: String(req.body.exitReceiverDocument || "").trim(),
        phone: "",
        relationship: "security",
        signatureUrl: exitReceiverSignature,
      },
      createdBy: req.user._id,
      closedAt: new Date(),
    });

    return res.status(201).json({
      message: "Salida directa registrada",
      report: serializeGateReport(report),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error creating direct exit" });
  }
}

async function closeExitReport(req, res) {
  try {
    if (!canAccessVigilance(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const report = await VehicleGateReport.findById(req.params.reportId);
    if (!report) {
      return res.status(404).json({ message: "Reporte no encontrado" });
    }
    if (report.status === "closed") {
      return res.status(400).json({ message: "Este reporte ya está cerrado" });
    }

    const exitDelivererName = String(req.body.exitDelivererName || "").trim();
    const exitReceiverName = String(req.body.exitReceiverName || "").trim();
    if (!exitDelivererName || !exitReceiverName) {
      return res.status(400).json({ message: "Indica responsables de entrega y recepción en salida" });
    }

    const exitDelivererSignature = await saveSignatureDataUrl(req.body.exitDelivererSignatureDataUrl);
    const exitReceiverSignature = await saveSignatureDataUrl(req.body.exitReceiverSignatureDataUrl);
    if (!exitDelivererSignature || !exitReceiverSignature) {
      return res.status(400).json({ message: "Se requieren ambas firmas de salida" });
    }

    const exitPhotos = await saveUploadedPhotos(req.files, "gate-reports");
    const plate = String(req.body.plate || report.vehicle?.plate || "").trim().toUpperCase();
    const brand = String(req.body.brand || report.vehicle?.brand || "").trim();
    const model = String(req.body.model || report.vehicle?.model || "").trim();
    if (!plate || !brand || !model) {
      return res.status(400).json({ message: "Completa placa, marca y modelo" });
    }

    report.exitDate = toBusinessNoon(req.body.exitDate || new Date()) || toUtcNoon(new Date());
    report.exitTime = String(req.body.exitTime || "").trim().slice(0, 5);
    if (["morning", "afternoon", "night"].includes(String(req.body.shift || ""))) {
      report.shift = String(req.body.shift);
    }
    report.exitObservations = String(req.body.exitObservations || "").trim().slice(0, 4000);
    if (req.body.generalObservations != null) {
      report.generalObservations = String(req.body.generalObservations || "").trim().slice(0, 4000);
    }
    report.vehicle = {
      ...(report.vehicle?.toObject ? report.vehicle.toObject() : report.vehicle || {}),
      plate,
      vin: String(req.body.vin || report.vehicle?.vin || "").trim().toUpperCase(),
      brand,
      model,
      year: String(req.body.year || report.vehicle?.year || "").trim(),
      color: String(req.body.color || report.vehicle?.color || "").trim(),
      version: String(req.body.version || report.vehicle?.version || "").trim(),
      mileage:
        req.body.mileage === "" || req.body.mileage == null
          ? report.vehicle?.mileage ?? null
          : Number(req.body.mileage),
      departureMethod: String(req.body.departureMethod || "").trim(),
    };
    if (req.body.documentsReceived != null) {
      report.documentsReceived = parseDocuments(req.body);
    }
    if (req.body.accessories != null) {
      report.accessories = parseAccessories(req.body);
    }
    report.exitPhotos = [...(report.exitPhotos || []), ...exitPhotos].slice(0, 12);
    report.exitDeliverer = {
      fullName: exitDelivererName,
      documentId: String(req.body.exitDelivererDocument || "").trim(),
      phone: String(req.body.exitDelivererPhone || "").trim(),
      relationship: String(req.body.exitDelivererRelationship || "").trim(),
      signatureUrl: exitDelivererSignature,
    };
    report.exitReceiver = {
      fullName: exitReceiverName,
      documentId: String(req.body.exitReceiverDocument || "").trim(),
      phone: "",
      relationship: "security",
      signatureUrl: exitReceiverSignature,
    };
    report.status = "closed";
    report.direction = "both";
    report.closedAt = new Date();
    await report.save();

    return res.status(200).json({
      message: "Salida registrada",
      report: serializeGateReport(report),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error closing exit report" });
  }
}

module.exports = {
  getPortalOverview,
  listGateReports,
  getGateReport,
  createEntryReport,
  createDirectExitReport,
  closeExitReport,
  ACCESSORY_CATALOG,
};
