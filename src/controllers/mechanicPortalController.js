const path = require("path");
const fs = require("fs");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const Maintenance = require("../models/Maintenance");
const MechanicServiceOrder = require("../models/MechanicServiceOrder");
const CotizadorMarketingLead = require("../models/CotizadorMarketingLead");
const User = require("../models/User");
const { toUtcNoon } = require("../services/maintenanceScheduleService");
const { uploadBufferToCloudinary, isCloudinaryConfigured } = require("../config/cloudinary");
const {
  buildMechanicDiagnosisPdfBuffer,
  buildMechanicDiagnosisFileName,
  buildMechanicDiagnosisEmailHtml,
} = require("../services/mechanicDiagnosisPdf");
const { sendBrevoEmail } = require("../services/brevoEmailService");

const NEXT_SERVICE_OFFSETS = {
  "5000": 5000,
  "10000": 10000,
  before5000: 4000,
};

function canAccessMechanicPortal(user) {
  const role = String(user?.role || "");
  return role === "mechanic" || role === "admin" || role === "manager";
}

const BUSINESS_TIMEZONE = "America/Bogota";

function toUtcDayKey(dateValue) {
  const date = toUtcNoon(dateValue);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

/** Calendar day in workshop timezone (Colombia), not raw UTC. */
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
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function toBusinessNoon(dateValue, timeZone = BUSINESS_TIMEZONE) {
  const key = toBusinessDayKey(dateValue, timeZone);
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

function serializeAppointmentVehicle(item, recordType) {
  return {
    id: String(item._id || ""),
    recordType,
    brand: item.brand || item.vehicleSnapshot?.brand || "",
    model: item.model || item.vehicleSnapshot?.model || "",
    version: item.version || item.vehicleSnapshot?.version || "",
    year: item.year || item.vehicleSnapshot?.year || "",
    plate: item.plate || item.vehicleSnapshot?.plate || "",
    appointmentDate: item.adminAppointmentDate || null,
    appointmentTime: item.adminAppointmentTime || "",
    currentMileage: item.currentMileage ?? item.reportedMileage ?? null,
  };
}

async function listScheduledAppointments() {
  const [clientVehicles, maintenanceDocs] = await Promise.all([
    ClientMaintenanceVehicle.find({ adminContactStatus: "appointment_scheduled" })
      .select("brand model version year plate adminAppointmentDate adminAppointmentTime currentMileage")
      .lean(),
    Maintenance.find({ adminContactStatus: "appointment_scheduled" })
      .select("vehicleSnapshot adminAppointmentDate adminAppointmentTime reportedMileage")
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
      reportedMileage: item.reportedMileage,
    }, "maintenance"));

  return [...fromClient, ...fromMaintenance].sort((left, right) => {
    const leftKey = `${toUtcDayKey(left.appointmentDate)}T${left.appointmentTime || "23:59"}`;
    const rightKey = `${toUtcDayKey(right.appointmentDate)}T${right.appointmentTime || "23:59"}`;
    return leftKey.localeCompare(rightKey);
  });
}

async function buildOrderNumber() {
  const seed = Date.now() % 900000;
  return `#GI-MEC-${String(seed).padStart(6, "0")}`;
}

function computeNextServiceKm(currentKm, nextServiceAnswer) {
  const current = Number(currentKm);
  if (!Number.isFinite(current) || current < 0) {
    return null;
  }
  const offset = NEXT_SERVICE_OFFSETS[String(nextServiceAnswer || "")] ?? null;
  if (offset == null) {
    return null;
  }
  return current + offset;
}

const DIAGNOSIS_QUESTION_KEYS = [
  "leaks", "faultCodes", "engine", "brakes", "suspension",
  "battery", "tires", "cooling", "wearComponents", "oxidation",
  "nextService", "overallState", "bodyDamage",
];

function parseQuestionNotes(body = {}) {
  let fromJson = body.questionNotes;
  if (typeof fromJson === "string") {
    try {
      fromJson = JSON.parse(fromJson);
    } catch (_error) {
      fromJson = {};
    }
  }
  if (!fromJson || typeof fromJson !== "object" || Array.isArray(fromJson)) {
    fromJson = {};
  }

  const notes = {};
  DIAGNOSIS_QUESTION_KEYS.forEach((key) => {
    const value = String(body[`note_${key}`] ?? fromJson[key] ?? "").trim().slice(0, 800);
    if (value) notes[key] = value;
  });
  return notes;
}

function parseDiagnosisPayload(body = {}) {
  let complementary = body.complementaryServices;
  if (typeof complementary === "string") {
    try {
      complementary = JSON.parse(complementary);
    } catch (_error) {
      complementary = complementary.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(complementary)) {
    complementary = [];
  }

  return {
    leaks: String(body.leaks || "").trim(),
    faultCodes: String(body.faultCodes || "").trim(),
    engine: String(body.engine || "").trim(),
    brakes: String(body.brakes || "").trim(),
    suspension: String(body.suspension || "").trim(),
    battery: String(body.battery || "").trim(),
    tires: String(body.tires || "").trim(),
    cooling: String(body.cooling || "").trim(),
    wearComponents: String(body.wearComponents || "").trim(),
    oxidation: String(body.oxidation || "").trim(),
    nextService: String(body.nextService || "").trim(),
    overallState: String(body.overallState || "").trim(),
    complementaryServices: complementary.map((item) => String(item || "").trim()).filter(Boolean),
    bodyDamage: String(body.bodyDamage || "").trim(),
    questionNotes: parseQuestionNotes(body),
    observations: String(body.observations || "").trim(),
  };
}

function fileIdentityKey(file = {}) {
  const name = String(file.originalname || file.name || "").trim().toLowerCase();
  const size = Number(file.size || file.buffer?.length || 0);
  return `${name}|${size}`;
}

async function saveUploadedPhotos(files = []) {
  const rawList = Array.isArray(files) ? files : [];
  const seen = new Set();
  const list = [];
  rawList.forEach((file) => {
    const key = fileIdentityKey(file);
    if (!key || key === "|0" || seen.has(key)) return;
    seen.add(key);
    list.push(file);
  });
  const limited = list.slice(0, 10);
  if (!limited.length) {
    return [];
  }

  if (isCloudinaryConfigured()) {
    const uploaded = [];
    for (const file of limited) {
      const result = await uploadBufferToCloudinary(file, "global-app/mechanic-diagnosis");
      uploaded.push({
        url: result.secure_url,
        publicId: result.public_id || "",
        name: file.originalname || "foto.jpg",
      });
    }
    return uploaded;
  }

  const uploadDir = path.join(__dirname, "..", "..", "uploads", "mechanic-diagnosis");
  fs.mkdirSync(uploadDir, { recursive: true });
  const uploaded = [];
  for (const file of limited) {
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || ".jpg")}`;
    const absolutePath = path.join(uploadDir, safeName);
    fs.writeFileSync(absolutePath, file.buffer);
    uploaded.push({
      url: `/uploads/mechanic-diagnosis/${safeName}`,
      publicId: "",
      name: file.originalname || safeName,
    });
  }
  return uploaded;
}

async function saveSignatureDataUrl(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:image/")) {
    return "";
  }
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return "";
  }
  const mime = match[1];
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > 1_500_000) {
    return "";
  }

  if (isCloudinaryConfigured()) {
    const result = await uploadBufferToCloudinary(
      { buffer, mimetype: mime, originalname: "firma.png" },
      "global-app/mechanic-signatures"
    );
    return result.secure_url || "";
  }

  const ext = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg" : ".png";
  const uploadDir = path.join(__dirname, "..", "..", "uploads", "mechanic-signatures");
  fs.mkdirSync(uploadDir, { recursive: true });
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(uploadDir, safeName), buffer);
  return `/uploads/mechanic-signatures/${safeName}`;
}

function resolveOrderAgendaDayKey(plain = {}) {
  // Walk-in: usar día de creación en Colombia (evita “hoy y mañana” por UTC)
  if (plain.sourceType === "walk_in") {
    return toBusinessDayKey(plain.createdAt || plain.appointmentDate);
  }
  return toBusinessDayKey(plain.appointmentDate || plain.createdAt);
}

function normalizeQuestionNotes(value) {
  if (!value) return {};
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function serializeOrder(order, { includeClient = true } = {}) {
  const plain = order.toObject ? order.toObject() : order;
  const diagnosis = plain.diagnosis || {};
  return {
    id: String(plain._id),
    orderNumber: plain.orderNumber,
    status: plain.status,
    sourceType: plain.sourceType,
    sourceId: plain.sourceId ? String(plain.sourceId) : null,
    vehicle: plain.vehicle || {},
    client: includeClient ? (plain.client || {}) : undefined,
    appointmentDate: plain.appointmentDate || null,
    appointmentTime: plain.appointmentTime || "",
    agendaDayKey: resolveOrderAgendaDayKey(plain),
    currentKm: plain.currentKm,
    nextServiceKm: plain.nextServiceKm,
    diagnosis: {
      ...diagnosis,
      questionNotes: normalizeQuestionNotes(diagnosis.questionNotes),
    },
    photos: plain.photos || [],
    technicianName: plain.technicianName || "",
    technicianSignatureUrl: plain.technicianSignatureUrl || "",
    billing: plain.billing || {},
    createdBy: plain.createdBy || null,
    completedAt: plain.completedAt || null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

function serializeMechanicDefaults(user) {
  return {
    fullName: String(user?.mechanicDefaults?.fullName || user?.name || "").trim(),
    signatureUrl: String(user?.mechanicDefaults?.signatureUrl || "").trim(),
  };
}

async function getPortalOverview(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Portal disponible solo para mecánicos / LATAM admin" });
    }

    const appointments = await listScheduledAppointments();
    const todayKey = toBusinessDayKey(new Date());
    const todayAppointments = appointments.filter((item) => toBusinessDayKey(item.appointmentDate) === todayKey);
    const openOrderQuery = { status: { $in: ["open", "diagnosis_saved"] } };
    if (String(req.user.role || "") === "mechanic") {
      openOrderQuery.createdBy = req.user._id;
    }
    const openOrders = await MechanicServiceOrder.find(openOrderQuery)
      .sort({ createdAt: -1 })
      .limit(30);

    // Corrige walk-in viejos que quedaron en el día UTC siguiente
    await Promise.all(openOrders.map(async (order) => {
      if (order.sourceType !== "walk_in") return;
      const correctNoon = toBusinessNoon(order.createdAt || new Date());
      if (!correctNoon) return;
      const currentKey = toBusinessDayKey(order.appointmentDate);
      const correctKey = toBusinessDayKey(correctNoon);
      if (currentKey !== correctKey) {
        order.appointmentDate = correctNoon;
        await order.save();
      }
    }));

    const userDoc = await User.findById(req.user._id).select("name mechanicDefaults").lean();

    return res.status(200).json({
      todayKey,
      todayAppointments,
      appointments: appointments.map((item) => ({
        ...item,
        agendaDayKey: toBusinessDayKey(item.appointmentDate),
      })),
      openOrders: openOrders.map((item) => serializeOrder(item)),
      mechanicDefaults: serializeMechanicDefaults(userDoc || req.user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading mechanic portal" });
  }
}

async function updateMechanicDefaults(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const fullName = String(req.body.fullName || "").trim().slice(0, 120);
    if (!fullName) {
      return res.status(400).json({ message: "Indica nombre y apellido del técnico" });
    }

    let signatureUrl = String(req.body.signatureUrl || user.mechanicDefaults?.signatureUrl || "").trim();
    const signatureDataUrl = String(req.body.signatureDataUrl || "").trim();
    if (signatureDataUrl) {
      const saved = await saveSignatureDataUrl(signatureDataUrl);
      if (saved) signatureUrl = saved;
    }

    user.mechanicDefaults = {
      fullName,
      signatureUrl,
    };
    await user.save();

    return res.status(200).json({
      message: "Datos del técnico guardados",
      mechanicDefaults: serializeMechanicDefaults(user),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error saving mechanic defaults" });
  }
}

async function createServiceOrder(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const mode = String(req.body.mode || "").trim();
    let payload = {
      sourceType: "walk_in",
      sourceId: null,
      vehicle: {
        brand: String(req.body.brand || "").trim(),
        model: String(req.body.model || "").trim(),
        version: String(req.body.version || "").trim(),
        year: String(req.body.year || "").trim(),
        plate: String(req.body.plate || "").trim().toUpperCase(),
      },
      client: {
        name: String(req.body.clientName || "").trim(),
        phone: String(req.body.clientPhone || "").trim(),
        email: String(req.body.clientEmail || "").trim().toLowerCase(),
      },
      appointmentDate: toBusinessNoon(new Date()),
      appointmentTime: "",
      currentKm: null,
    };

    if (mode === "appointment") {
      const sourceId = String(req.body.sourceId || "").trim();
      const recordType = String(req.body.recordType || "").trim();
      if (!sourceId || !["client_vehicle", "maintenance"].includes(recordType)) {
        return res.status(400).json({ message: "Selecciona una cita válida del día" });
      }

      if (recordType === "client_vehicle") {
        const vehicle = await ClientMaintenanceVehicle.findById(sourceId).populate("user", "name email phone").populate("client", "name email phone").lean();
        if (!vehicle) {
          return res.status(404).json({ message: "Cita no encontrada" });
        }
        payload = {
          sourceType: "appointment_client_vehicle",
          sourceId: vehicle._id,
          vehicle: {
            brand: vehicle.brand || "",
            model: vehicle.model || "",
            version: vehicle.version || "",
            year: vehicle.year != null ? String(vehicle.year) : "",
            plate: vehicle.plate || "",
          },
          client: {
            name: vehicle.user?.name || vehicle.client?.name || "",
            phone: vehicle.user?.phone || vehicle.client?.phone || "",
            email: vehicle.user?.email || vehicle.client?.email || "",
          },
          appointmentDate: vehicle.adminAppointmentDate || toUtcNoon(new Date()),
          appointmentTime: vehicle.adminAppointmentTime || "",
          currentKm: vehicle.currentMileage ?? null,
        };
      } else {
        const maintenance = await Maintenance.findById(sourceId).populate("client", "name email phone").lean();
        if (!maintenance) {
          return res.status(404).json({ message: "Cita no encontrada" });
        }
        payload = {
          sourceType: "appointment_maintenance",
          sourceId: maintenance._id,
          vehicle: {
            brand: maintenance.vehicleSnapshot?.brand || "",
            model: maintenance.vehicleSnapshot?.model || "",
            version: maintenance.vehicleSnapshot?.version || "",
            year: maintenance.vehicleSnapshot?.year != null ? String(maintenance.vehicleSnapshot.year) : "",
            plate: maintenance.vehicleSnapshot?.plate || "",
          },
          client: {
            name: maintenance.contactName || maintenance.client?.name || "",
            phone: maintenance.contactPhone || maintenance.client?.phone || "",
            email: maintenance.contactEmail || maintenance.client?.email || "",
          },
          appointmentDate: maintenance.adminAppointmentDate || toUtcNoon(new Date()),
          appointmentTime: maintenance.adminAppointmentTime || "",
          currentKm: maintenance.reportedMileage ?? null,
        };
      }
    } else {
      if (!payload.client.name || !payload.vehicle.brand || !payload.vehicle.model || !payload.vehicle.plate) {
        return res.status(400).json({ message: "Completa cliente, marca, modelo y placa" });
      }
    }

    const order = await MechanicServiceOrder.create({
      ...payload,
      orderNumber: await buildOrderNumber(),
      status: "open",
      createdBy: req.user._id,
    });

    return res.status(201).json({
      message: "Orden de servicio abierta",
      order: serializeOrder(order),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error creating service order" });
  }
}

async function getServiceOrder(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const order = await MechanicServiceOrder.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    return res.status(200).json({ order: serializeOrder(order) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading order" });
  }
}

async function updateServiceOrder(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const order = await MechanicServiceOrder.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    if (
      String(req.user.role || "") === "mechanic"
      && String(order.createdBy || "") !== String(req.user._id)
    ) {
      return res.status(403).json({ message: "No puedes editar esta orden" });
    }

    const brand = String(req.body.brand ?? order.vehicle?.brand ?? "").trim();
    const model = String(req.body.model ?? order.vehicle?.model ?? "").trim();
    const version = String(req.body.version ?? order.vehicle?.version ?? "").trim();
    const year = String(req.body.year ?? order.vehicle?.year ?? "").trim();
    const plate = String(req.body.plate ?? order.vehicle?.plate ?? "").trim().toUpperCase();
    const clientName = String(req.body.clientName ?? order.client?.name ?? "").trim();
    const clientPhone = String(req.body.clientPhone ?? order.client?.phone ?? "").trim();
    const clientEmail = String(req.body.clientEmail ?? order.client?.email ?? "").trim().toLowerCase();

    if (!clientName || !brand || !model || !plate) {
      return res.status(400).json({ message: "Completa cliente, marca, modelo y placa" });
    }

    order.vehicle = { brand, model, version, year, plate };
    order.client = { name: clientName, phone: clientPhone, email: clientEmail };
    await order.save();

    return res.status(200).json({
      message: "Datos actualizados",
      order: serializeOrder(order),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating order" });
  }
}

async function saveDiagnosis(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const order = await MechanicServiceOrder.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    const diagnosis = parseDiagnosisPayload(req.body);
    const requiredKeys = [
      "leaks", "faultCodes", "engine", "brakes", "suspension",
      "battery", "tires", "cooling", "wearComponents", "oxidation",
      "nextService", "overallState", "bodyDamage",
    ];
    const missing = requiredKeys.find((key) => !diagnosis[key]);
    if (missing) {
      return res.status(400).json({ message: "Completa todas las preguntas del diagnóstico" });
    }

    const currentKm = req.body.currentKm === "" || req.body.currentKm == null
      ? null
      : Number(req.body.currentKm);
    if (currentKm == null || !Number.isFinite(currentKm) || currentKm < 0) {
      return res.status(400).json({ message: "Indica el kilometraje actual" });
    }

    const photos = await saveUploadedPhotos(req.files);
    let keepPhotoUrls = req.body.keepPhotoUrls;
    if (typeof keepPhotoUrls === "string") {
      try {
        keepPhotoUrls = JSON.parse(keepPhotoUrls);
      } catch (_error) {
        keepPhotoUrls = null;
      }
    }
    const existingPhotos = Array.isArray(order.photos) ? order.photos : [];
    const keepSet = Array.isArray(keepPhotoUrls)
      ? new Set(keepPhotoUrls.map((item) => String(item || "").trim()).filter(Boolean))
      : null;
    const retainedPhotos = keepSet
      ? existingPhotos.filter((item) => keepSet.has(String(item.url || "").trim()))
      : (photos.length ? [] : existingPhotos);
    const retainedNames = new Set(
      retainedPhotos.map((item) => String(item.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const uniqueNewPhotos = photos.filter((item) => {
      const name = String(item.name || "").trim().toLowerCase();
      if (name && retainedNames.has(name)) return false;
      if (name) retainedNames.add(name);
      return true;
    });
    const mergedPhotos = [...retainedPhotos, ...uniqueNewPhotos].slice(0, 10);

    const technicianName = String(req.body.technicianName || "").trim().slice(0, 120);
    if (!technicianName) {
      return res.status(400).json({ message: "Indica el nombre y apellido del técnico" });
    }

    let technicianSignatureUrl = String(order.technicianSignatureUrl || "").trim();
    const signatureDataUrl = String(req.body.technicianSignatureDataUrl || "").trim();
    const existingSignatureUrl = String(req.body.technicianSignatureUrl || "").trim();
    if (signatureDataUrl) {
      const saved = await saveSignatureDataUrl(signatureDataUrl);
      if (!saved) {
        return res.status(400).json({ message: "No se pudo guardar la firma del técnico" });
      }
      technicianSignatureUrl = saved;
    } else if (existingSignatureUrl) {
      technicianSignatureUrl = existingSignatureUrl;
    }
    if (!technicianSignatureUrl) {
      return res.status(400).json({ message: "Firma del técnico requerida" });
    }

    order.diagnosis = diagnosis;
    order.currentKm = currentKm;
    order.nextServiceKm = computeNextServiceKm(currentKm, diagnosis.nextService);
    order.photos = mergedPhotos;
    order.technicianName = technicianName;
    order.technicianSignatureUrl = technicianSignatureUrl;
    order.status = "diagnosis_saved";
    order.completedAt = new Date();
    await order.save();

    const saveAsDefault = !(
      req.body.saveTechnicianDefault === false
      || req.body.saveTechnicianDefault === "false"
      || req.body.saveTechnicianDefault === 0
      || req.body.saveTechnicianDefault === "0"
    );
    if (saveAsDefault && req.user?._id) {
      await User.findByIdAndUpdate(req.user._id, {
        $set: {
          "mechanicDefaults.fullName": technicianName,
          "mechanicDefaults.signatureUrl": technicianSignatureUrl,
        },
      });
    }

    const sendEmailRequested = !(
      req.body.sendEmail === false
      || req.body.sendEmail === "false"
      || req.body.sendEmail === 0
      || req.body.sendEmail === "0"
    );

    let emailSent = false;
    let emailError = "";
    const clientEmail = String(order.client?.email || "").trim().toLowerCase();
    const clientName = String(order.client?.name || "").trim();
    const clientPhone = String(order.client?.phone || "").trim();
    const vehicleTitle = [order.vehicle?.brand, order.vehicle?.model, order.vehicle?.year]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (sendEmailRequested) {
      if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
        emailError = "El cliente no tiene un correo válido para enviar el diagnóstico";
      } else {
        try {
          const pdfBuffer = await buildMechanicDiagnosisPdfBuffer(order.toObject ? order.toObject() : order);
          const pdfFileName = buildMechanicDiagnosisFileName(order);
          await sendBrevoEmail({
            toEmail: clientEmail,
            toName: clientName || "Cliente",
            subject: `Diagnóstico de servicio · ${vehicleTitle || "Global Imports"} | Global Imports`,
            htmlContent: buildMechanicDiagnosisEmailHtml(order),
            senderName: "Global Imports",
            senderEmail: "info@globalimportsus.com",
            attachments: [{ name: pdfFileName, content: pdfBuffer }],
          });
          emailSent = true;
        } catch (error) {
          emailError = error.message || "No se pudo enviar el correo";
        }
      }
    }

    const addToMarketing = !(
      req.body.addToMarketing === false
      || req.body.addToMarketing === "false"
      || req.body.addToMarketing === 0
      || req.body.addToMarketing === "0"
    );

    let marketingSaved = false;
    let marketingError = "";
    if (addToMarketing) {
      const marketingEmail = clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)
        ? clientEmail
        : "";
      if (!clientName || !marketingEmail) {
        marketingError = "Para marketing a 6 meses se necesita nombre y correo del cliente";
      } else {
        try {
          const followUpAt = new Date(order.completedAt || Date.now());
          followUpAt.setMonth(followUpAt.getMonth() + 6);
          await CotizadorMarketingLead.findOneAndUpdate(
            { email: marketingEmail },
            {
              $set: {
                name: clientName,
                email: marketingEmail,
                phone: clientPhone,
                identification: String(order.vehicle?.plate || "").trim().toUpperCase(),
                vehicleLabel: vehicleTitle || String(order.vehicle?.plate || "Servicio taller"),
                followUpAt,
                source: "taller",
                createdBy: req.user?._id || req.user?.id || null,
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          marketingSaved = true;
        } catch (error) {
          marketingError = error.message || "No se pudo agendar el marketing a 6 meses";
        }
      }
    }

    return res.status(200).json({
      message: emailSent
        ? `Diagnóstico guardado y enviado a ${clientEmail}`
        : "Diagnóstico guardado",
      order: serializeOrder(order),
      emailSent,
      emailError,
      clientEmail: clientEmail || "",
      marketingSaved,
      marketingError,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error saving diagnosis" });
  }
}

async function downloadDiagnosisPdf(req, res) {
  try {
    if (!canAccessMechanicPortal(req.user)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const order = await MechanicServiceOrder.findById(req.params.orderId).lean();
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }
    if (order.status === "open") {
      return res.status(400).json({ message: "Guarda el diagnóstico antes de generar el PDF" });
    }

    const pdfBuffer = await buildMechanicDiagnosisPdfBuffer(order);
    const fileName = buildMechanicDiagnosisFileName(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error generating PDF" });
  }
}

async function listDiagnosesForAdmin(req, res) {
  try {
    const role = String(req.user?.role || "");
    if (!["admin", "manager"].includes(role)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const orders = await MechanicServiceOrder.find({ status: { $in: ["diagnosis_saved", "closed"] } })
      .populate("createdBy", "name email")
      .sort({ completedAt: -1, createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({
      orders: orders.map((item) => serializeOrder(item)),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error listing diagnoses" });
  }
}

module.exports = {
  getPortalOverview,
  updateMechanicDefaults,
  createServiceOrder,
  getServiceOrder,
  updateServiceOrder,
  saveDiagnosis,
  downloadDiagnosisPdf,
  listDiagnosesForAdmin,
};
