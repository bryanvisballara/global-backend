const XLSX = require("xlsx");
const CotizadorSupply = require("../models/CotizadorSupply");
const CotizadorVehicle = require("../models/CotizadorVehicle");
const CotizadorSettings = require("../models/CotizadorSettings");
const CotizadorMarketingLead = require("../models/CotizadorMarketingLead");
const {
  importCotizadorWorkbook,
  normalizeText,
  normalizeKey,
} = require("../services/cotizadorExcelService");
const { sendBrevoEmail } = require("../services/brevoEmailService");
const {
  buildClientServiceItems,
  buildQuoteDocumentHtml,
  buildQuoteEmailHtml,
  buildQuoteTotals,
  buildVehicleLabel,
  resolveLogoUrl,
  COMPANY,
} = require("../services/cotizadorQuoteDocument");
const {
  buildQuotePdfBuffer,
  buildQuotePdfFileName,
} = require("../services/cotizadorQuotePdf");

const TYPE_LABELS = {
  oil: "Aceite motor",
  oil_filter: "Filtro aceite",
  drain_plug_gasket: "Empaque / sello",
  engine_air_filter: "Filtro aire motor",
  cabin_air_filter: "Filtro cabina / A/C",
  other: "Servicio taller",
};

function canAccessLatam(requester) {
  const role = String(requester?.role || "");
  return role === "admin" || role === "manager";
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeSupply(supply) {
  const doc = supply.toObject ? supply.toObject() : supply;
  return {
    ...doc,
    id: String(doc._id),
    typeLabel: TYPE_LABELS[doc.type] || doc.type,
  };
}

function serializeSettings(settings) {
  return {
    laborPrice: Number(settings?.laborPrice || 0),
    laborAlistamiento: Number(settings?.laborAlistamiento || 0),
    currency: settings?.currency || "COP",
    notes: settings?.notes || "",
  };
}

function serializeVehicle(vehicle) {
  const doc = vehicle.toObject ? vehicle.toObject() : vehicle;
  return {
    ...doc,
    id: String(doc._id),
    parts: (doc.parts || []).map((part) => ({
      ...part,
      supply: part.supply ? serializeSupply(part.supply) : null,
      typeLabel: TYPE_LABELS[part.type] || part.type,
    })),
  };
}

async function getOrCreateSettings() {
  let settings = await CotizadorSettings.findOne({ key: "default" });
    if (!settings) {
      settings = await CotizadorSettings.create({
        key: "default",
        laborPrice: 150000,
        laborAlistamiento: 30000,
        currency: "COP",
      });
    }
  return settings;
}

function buildSelectorOptions(vehicles) {
  const brands = new Map();

  for (const vehicle of vehicles) {
    const brand = normalizeText(vehicle.brand);
    const model = normalizeText(vehicle.model);
    if (!brand || !model) {
      continue;
    }

    if (!brands.has(brand)) {
      brands.set(brand, new Map());
    }

    const models = brands.get(brand);
    if (!models.has(model)) {
      models.set(model, { years: new Set(), variants: [] });
    }

    const entry = models.get(model);
    const from = Number(vehicle.yearFrom);
    const to = Number(vehicle.yearTo || vehicle.yearFrom);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      for (let year = from; year <= to; year += 1) {
        entry.years.add(year);
      }
    }

    entry.variants.push({
      id: String(vehicle.id || vehicle._id),
      label: normalizeText(vehicle.variantLabel) || `${model}${vehicle.engineCode ? ` ${vehicle.engineCode}` : ""}`,
      engineCode: normalizeText(vehicle.engineCode),
      yearFrom: vehicle.yearFrom,
      yearTo: vehicle.yearTo,
    });
  }

  return Array.from(brands.entries())
    .sort((left, right) => left[0].localeCompare(right[0], "es"))
    .map(([brand, models]) => ({
      brand,
      models: Array.from(models.entries())
        .sort((left, right) => left[0].localeCompare(right[0], "es"))
        .map(([model, entry]) => ({
          model,
          years: Array.from(entry.years).sort((left, right) => left - right),
          variants: entry.variants
            .slice()
            .sort((left, right) => String(left.label).localeCompare(String(right.label), "es")),
        })),
    }));
}

function resolveLaborPrice(vehicle, settings) {
  if (vehicle?.laborPrice !== null && vehicle?.laborPrice !== undefined && Number(vehicle.laborPrice) >= 0) {
    return Number(vehicle.laborPrice);
  }
  return Number(settings?.laborPrice || 0);
}

function resolveAlistamientoPrice(settings) {
  return Math.max(0, Number(settings?.laborAlistamiento || 0));
}

function resolveSalePrice(vehicle, costTotal) {
  const mode = normalizeText(vehicle?.salePriceMode);
  const rawValue = vehicle?.salePriceValue;
  if (!mode || rawValue === null || rawValue === undefined || rawValue === "") {
    return Math.round(Number(costTotal || 0));
  }

  const value = Math.max(0, Number(rawValue) || 0);
  const base = Math.max(0, Number(costTotal || 0));

  if (mode === "fixed") {
    return Math.round(value);
  }
  if (mode === "amount") {
    return Math.round(base + value);
  }
  if (mode === "percent") {
    return Math.round(base * (1 + (value / 100)));
  }

  return Math.round(base);
}

function partDisplayLabel(part, supply = {}) {
  if (part?.type === "other") {
    return normalizeText(supply.specification || supply.name || part.notes) || "Ítem de taller";
  }
  return TYPE_LABELS[part?.type] || part?.type || "Insumo";
}

function buildQuoteForVehicle(vehicle, settings) {
  const parts = (vehicle.parts || []).map((part) => {
    const supply = part.supply || {};
    const quantityValue = Number(part.quantityValue || 1);
    const unitCost = Number(supply.unitCost || 0);
    const lineCost = unitCost * quantityValue;
    const stock = Number(supply.stock || 0);

    const ignoreStock = Boolean(supply.ignoreStock);
    return {
      type: part.type,
      typeLabel: partDisplayLabel(part, supply),
      quantityLabel: part.quantityLabel,
      quantityValue,
      notes: part.notes || "",
      supply: serializeSupply(supply),
      unitCost,
      lineCost,
      stock,
      ignoreStock,
      enough: ignoreStock || stock >= quantityValue,
    };
  });

  const partsCost = parts.reduce((sum, part) => sum + Number(part.lineCost || 0), 0);
  const laborMecanico = resolveLaborPrice(vehicle, settings);
  const laborAlistamiento = resolveAlistamientoPrice(settings);
  const laborTotal = laborMecanico + laborAlistamiento;
  const costTotal = Math.round(partsCost + laborTotal);
  const salePrice = resolveSalePrice(vehicle, costTotal);
  const missing = parts.filter((part) => !part.enough);

  return {
    vehicle: {
      id: String(vehicle._id),
      brand: vehicle.brand,
      model: vehicle.model,
      variantLabel: vehicle.variantLabel,
      engineCode: vehicle.engineCode,
      yearFrom: vehicle.yearFrom,
      yearTo: vehicle.yearTo,
      laborPrice: vehicle.laborPrice,
      salePriceMode: vehicle.salePriceMode || null,
      salePriceValue: vehicle.salePriceValue === null || vehicle.salePriceValue === undefined
        ? null
        : Number(vehicle.salePriceValue),
    },
    parts,
    missing,
    canService: parts.length > 0 && missing.length === 0,
    pricing: {
      partsCost: Math.round(partsCost),
      laborMecanico: Math.round(laborMecanico),
      laborAlistamiento: Math.round(laborAlistamiento),
      laborPrice: Math.round(laborTotal),
      costTotal,
      salePrice,
      total: costTotal,
      currency: settings?.currency || "COP",
    },
  };
}

async function getCotizadorOverview(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const [supplies, vehicles, supplyCount, vehicleCount, zeroStockCount, settings] = await Promise.all([
      CotizadorSupply.find({}).sort({ type: 1, specification: 1 }).limit(1000).lean(),
      CotizadorVehicle.find({})
        .select("brand model variantLabel engineCode yearFrom yearTo parts")
        .sort({ brand: 1, model: 1, yearFrom: 1 })
        .limit(2000)
        .lean(),
      CotizadorSupply.countDocuments({}),
      CotizadorVehicle.countDocuments({}),
      CotizadorSupply.countDocuments({ stock: 0 }),
      getOrCreateSettings(),
    ]);

    const listVehicles = vehicles.map((vehicle) => ({
      id: String(vehicle._id),
      brand: vehicle.brand,
      model: vehicle.model,
      variantLabel: vehicle.variantLabel,
      engineCode: vehicle.engineCode || "",
      yearFrom: vehicle.yearFrom,
      yearTo: vehicle.yearTo,
      partsCount: Array.isArray(vehicle.parts) ? vehicle.parts.length : 0,
    }));

    return res.status(200).json({
      summary: {
        supplies: supplyCount,
        vehicles: vehicleCount,
        zeroStock: zeroStockCount,
      },
      settings: serializeSettings(settings),
      selectorOptions: buildSelectorOptions(listVehicles),
      supplies: supplies.map(serializeSupply),
      vehicles: listVehicles,
      typeLabels: TYPE_LABELS,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading cotizador" });
  }
}

async function loadQuoteVehicle({ vehicleId, brand, model, year }) {
  if (!vehicleId) {
    const error = new Error("Selecciona la versión/motor del vehículo. Gasolina y diésel no comparten los mismos insumos.");
    error.status = 400;
    throw error;
  }

  const settings = await getOrCreateSettings();
  const vehicle = await CotizadorVehicle.findById(vehicleId).populate("parts.supply");

  if (!vehicle) {
    const error = new Error("No hay ficha de mantenimiento para esa versión");
    error.status = 404;
    throw error;
  }

  if (brand && normalizeText(vehicle.brand).toLowerCase() !== brand.toLowerCase()) {
    const error = new Error("La versión no coincide con la marca seleccionada");
    error.status = 400;
    throw error;
  }
  if (model && normalizeText(vehicle.model).toLowerCase() !== model.toLowerCase()) {
    const error = new Error("La versión no coincide con el modelo seleccionado");
    error.status = 400;
    throw error;
  }
  if (Number.isFinite(year) && year > 0) {
    const from = Number(vehicle.yearFrom || 0);
    const to = Number(vehicle.yearTo || vehicle.yearFrom || 0);
    if (year < from || year > to) {
      const error = new Error("La versión no cubre el año seleccionado");
      error.status = 400;
      throw error;
    }
  }

  return {
    settings,
    vehicle,
    quote: buildQuoteForVehicle(vehicle, settings),
  };
}

async function getQuote(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const brand = normalizeText(req.query.brand);
    const model = normalizeText(req.query.model);
    const year = Number(req.query.year);
    const vehicleId = normalizeText(req.query.vehicleId);
    const { quote, settings } = await loadQuoteVehicle({ vehicleId, brand, model, year });

    return res.status(200).json({
      quote,
      settings: serializeSettings(settings),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error building quote" });
  }
}

async function getPricingBoard(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const [settings, vehicles] = await Promise.all([
      getOrCreateSettings(),
      CotizadorVehicle.find({})
        .populate("parts.supply")
        .sort({ brand: 1, model: 1, yearFrom: 1, variantLabel: 1 })
        .limit(2000),
    ]);

    const items = vehicles.map((vehicle) => {
      const quote = buildQuoteForVehicle(vehicle, settings);
      const hasCustomLabor = vehicle.laborPrice !== null && vehicle.laborPrice !== undefined;
      const needsPricing = Boolean(
        quote.canService
        && (Number(quote.pricing.laborPrice || 0) <= 0 || Number(quote.pricing.partsCost || 0) <= 0)
      );

      return {
        id: quote.vehicle.id,
        brand: quote.vehicle.brand,
        model: quote.vehicle.model,
        variantLabel: quote.vehicle.variantLabel,
        engineCode: quote.vehicle.engineCode || "",
        yearFrom: quote.vehicle.yearFrom,
        yearTo: quote.vehicle.yearTo,
        laborPrice: hasCustomLabor ? Number(vehicle.laborPrice) : null,
        effectiveLaborPrice: Number(quote.pricing.laborMecanico || 0),
        laborAlistamiento: Number(quote.pricing.laborAlistamiento || 0),
        hasCustomLabor,
        partsCost: Number(quote.pricing.partsCost || 0),
        total: Number(quote.pricing.total || 0),
        canService: Boolean(quote.canService),
        missingCount: Array.isArray(quote.missing) ? quote.missing.length : 0,
        partsCount: Array.isArray(quote.parts) ? quote.parts.length : 0,
        needsPricing,
      };
    });

    items.sort((left, right) => {
      if (left.needsPricing !== right.needsPricing) {
        return left.needsPricing ? -1 : 1;
      }
      if (left.canService !== right.canService) {
        return left.canService ? -1 : 1;
      }
      return `${left.brand} ${left.model} ${left.variantLabel}`
        .localeCompare(`${right.brand} ${right.model} ${right.variantLabel}`, "es");
    });

    const summary = {
      total: items.length,
      ready: items.filter((item) => item.canService).length,
      missingStock: items.filter((item) => !item.canService).length,
      needsPricing: items.filter((item) => item.needsPricing).length,
      customLabor: items.filter((item) => item.hasCustomLabor).length,
    };

    return res.status(200).json({
      settings: serializeSettings(settings),
      summary,
      vehicles: items,
      selectorOptions: buildSelectorOptions(items),
      typeLabels: TYPE_LABELS,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading pricing board" });
  }
}

async function updateSettings(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const settings = await getOrCreateSettings();

    if (req.body.laborPrice !== undefined) {
      settings.laborPrice = Math.max(0, Number(req.body.laborPrice) || 0);
    }

    if (req.body.laborAlistamiento !== undefined) {
      settings.laborAlistamiento = Math.max(0, Number(req.body.laborAlistamiento) || 0);
    }

    if (typeof req.body.notes === "string") {
      settings.notes = normalizeText(req.body.notes);
    }

    if (typeof req.body.currency === "string" && req.body.currency.trim()) {
      settings.currency = normalizeText(req.body.currency).toUpperCase();
    }

    await settings.save();

    return res.status(200).json({
      message: "Precios de mantenimiento actualizados",
      settings: serializeSettings(settings),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating settings" });
  }
}

async function updateVehiclePricing(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const vehicle = await CotizadorVehicle.findById(req.params.vehicleId);
    if (!vehicle) {
      return res.status(404).json({ message: "Vehículo no encontrado" });
    }

    if (req.body.laborPrice === null || req.body.laborPrice === "") {
      vehicle.laborPrice = null;
    } else if (req.body.laborPrice !== undefined) {
      vehicle.laborPrice = Math.max(0, Number(req.body.laborPrice) || 0);
    }

    if (req.body.salePriceMode !== undefined) {
      const mode = normalizeText(req.body.salePriceMode);
      if (["fixed", "amount", "percent"].includes(mode)) {
        vehicle.salePriceMode = mode;
      } else {
        vehicle.salePriceMode = undefined;
        vehicle.set("salePriceMode", undefined);
      }
    }

    if (req.body.salePriceValue === null || req.body.salePriceValue === "") {
      vehicle.salePriceValue = undefined;
      vehicle.set("salePriceValue", undefined);
    } else if (req.body.salePriceValue !== undefined) {
      vehicle.salePriceValue = Math.max(0, Number(req.body.salePriceValue) || 0);
    }

    await vehicle.save();

    const supplyUpdates = Array.isArray(req.body.supplies) ? req.body.supplies : [];
    for (const item of supplyUpdates) {
      const supplyId = normalizeText(item.supplyId || item.id);
      if (!supplyId) {
        continue;
      }

      const supply = await CotizadorSupply.findById(supplyId);
      if (!supply) {
        continue;
      }

      if (item.unitCost !== undefined) {
        supply.unitCost = Math.max(0, Number(item.unitCost) || 0);
      }

      if (item.stock !== undefined) {
        supply.stock = Math.max(0, Number(item.stock) || 0);
      }

      await supply.save();
    }

    const refreshed = await CotizadorVehicle.findById(vehicle._id).populate("parts.supply");
    const settings = await getOrCreateSettings();

    return res.status(200).json({
      message: "Precios actualizados",
      quote: buildQuoteForVehicle(refreshed, settings),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating vehicle pricing" });
  }
}

function buildSupplyFilter(query = {}) {
  const type = normalizeText(query.type);
  const q = normalizeText(query.q);
  const filter = {};

  if (type) {
    filter.type = type;
  }

  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    filter.$or = [
      { specification: regex },
      { oemCode: regex },
      { name: regex },
      { searchKey: regex },
    ];
  }

  return filter;
}

function formatVehicleYears(vehicle) {
  const from = vehicle.yearFrom || "?";
  const to = vehicle.yearTo || "?";
  return `${from}-${to}`;
}

function formatVehicleLabel(vehicle) {
  const years = formatVehicleYears(vehicle);
  const engine = vehicle.engineCode ? ` · ${vehicle.engineCode}` : "";
  return `${vehicle.brand || ""} ${vehicle.variantLabel || vehicle.model || ""}${engine} (${years})`.replace(/\s+/g, " ").trim();
}

async function loadSuppliesWithCompatibility(filter = {}) {
  const supplies = await CotizadorSupply.find(filter).sort({ type: 1, specification: 1 }).lean();
  const supplyIds = supplies.map((item) => item._id);
  const vehicles = await CotizadorVehicle.find({ "parts.supply": { $in: supplyIds } })
    .select("brand model variantLabel engineCode yearFrom yearTo parts")
    .sort({ brand: 1, model: 1, yearFrom: 1 })
    .lean();

  const compatibleBySupply = {};
  for (const supply of supplies) {
    compatibleBySupply[String(supply._id)] = vehicles
      .filter((vehicle) => (vehicle.parts || []).some((part) => String(part.supply) === String(supply._id)))
      .map((vehicle) => ({
        id: String(vehicle._id),
        brand: vehicle.brand,
        model: vehicle.model,
        variantLabel: vehicle.variantLabel,
        engineCode: vehicle.engineCode,
        yearFrom: vehicle.yearFrom,
        yearTo: vehicle.yearTo,
      }));
  }

  return supplies
    .map((supply) => ({
      ...serializeSupply(supply),
      compatibleVehicles: compatibleBySupply[String(supply._id)] || [],
      compatibleCount: (compatibleBySupply[String(supply._id)] || []).length,
    }))
    .sort((left, right) => {
      const byCars = Number(right.compatibleCount || 0) - Number(left.compatibleCount || 0);
      if (byCars !== 0) {
        return byCars;
      }
      return String(left.specification || "").localeCompare(String(right.specification || ""), "es");
    });
}

async function listSupplies(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const supplies = await loadSuppliesWithCompatibility(buildSupplyFilter(req.query));
    return res.status(200).json({ supplies });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error listing supplies" });
  }
}

async function exportSuppliesXlsx(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const brandFilter = normalizeText(req.query.brand);
    const modelFilter = normalizeText(req.query.model);
    let supplies = await loadSuppliesWithCompatibility(buildSupplyFilter(req.query));

    if (brandFilter || modelFilter) {
      supplies = supplies
        .map((supply) => {
          const vehicles = (supply.compatibleVehicles || []).filter((vehicle) => {
            if (brandFilter && normalizeText(vehicle.brand).toLowerCase() !== brandFilter.toLowerCase()) {
              return false;
            }
            if (modelFilter && normalizeText(vehicle.model).toLowerCase() !== modelFilter.toLowerCase()) {
              return false;
            }
            return true;
          });
          return {
            ...supply,
            compatibleVehicles: vehicles,
            compatibleCount: vehicles.length,
          };
        })
        .filter((supply) => supply.compatibleCount > 0)
        .sort((left, right) => Number(right.compatibleCount || 0) - Number(left.compatibleCount || 0));
    }

    const summaryRows = supplies.map((supply) => ({
      Tipo: supply.typeLabel || supply.type || "",
      Especificación: supply.specification || "",
      OEM: supply.oemCode || "",
      Nombre: supply.name || "",
      Stock: Number(supply.stock || 0),
      "Costo unitario": Number(supply.unitCost || 0),
      Unidad: supply.unit || "",
      "Cant. vehículos": Number(supply.compatibleCount || 0),
      "Vehículos compatibles": (supply.compatibleVehicles || []).map(formatVehicleLabel).join(" | "),
      Proveedor: supply.provider || "",
      Notas: supply.notes || "",
    }));

    const detailRows = [];
    for (const supply of supplies) {
      const vehicles = supply.compatibleVehicles || [];
      if (!vehicles.length) {
        detailRows.push({
          Tipo: supply.typeLabel || supply.type || "",
          Especificación: supply.specification || "",
          OEM: supply.oemCode || "",
          Stock: Number(supply.stock || 0),
          "Costo unitario": Number(supply.unitCost || 0),
          Marca: "",
          Modelo: "",
          Variante: "",
          Motor: "",
          "Año desde": "",
          "Año hasta": "",
        });
        continue;
      }

      for (const vehicle of vehicles) {
        detailRows.push({
          Tipo: supply.typeLabel || supply.type || "",
          Especificación: supply.specification || "",
          OEM: supply.oemCode || "",
          Stock: Number(supply.stock || 0),
          "Costo unitario": Number(supply.unitCost || 0),
          Marca: vehicle.brand || "",
          Modelo: vehicle.model || "",
          Variante: vehicle.variantLabel || "",
          Motor: vehicle.engineCode || "",
          "Año desde": vehicle.yearFrom || "",
          "Año hasta": vehicle.yearTo || "",
        });
      }
    }

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ Tipo: "" }]);
    const detailSheet = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ Tipo: "" }]);
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Insumos");
    XLSX.utils.book_append_sheet(workbook, detailSheet, "Compatibilidad");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `cotizador-insumos-${stamp}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error exporting supplies" });
  }
}

async function createSupply(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const type = normalizeText(req.body.type) || "other";
    const name = normalizeText(req.body.name);
    const specification = normalizeText(req.body.specification);
    if (!name || !specification) {
      return res.status(400).json({ message: "Nombre y especificación son obligatorios" });
    }

    const supply = await CotizadorSupply.create({
      type,
      name,
      specification,
      oemCode: type === "oil" ? "" : specification.toUpperCase(),
      provider: normalizeText(req.body.provider),
      stock: Math.max(0, Number(req.body.stock || 0)),
      unitCost: Math.max(0, Number(req.body.unitCost || 0)),
      unit: normalizeText(req.body.unit) || (type === "oil" ? "L" : "und"),
      notes: normalizeText(req.body.notes),
      link: normalizeText(req.body.link),
      searchKey: normalizeKey(type, name, specification),
    });

    return res.status(201).json({
      message: "Insumo creado",
      supply: serializeSupply(supply),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error creating supply" });
  }
}

async function updateSupply(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const supply = await CotizadorSupply.findById(req.params.supplyId);
    if (!supply) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    ["name", "specification", "provider", "unit", "notes", "link", "type"].forEach((field) => {
      if (req.body[field] !== undefined) {
        supply[field] = normalizeText(req.body[field]);
      }
    });

    if (req.body.stock !== undefined) {
      supply.stock = Math.max(0, Number(req.body.stock) || 0);
    }

    if (req.body.unitCost !== undefined) {
      supply.unitCost = Math.max(0, Number(req.body.unitCost) || 0);
    }

    if (supply.type !== "oil") {
      supply.oemCode = normalizeText(supply.specification).toUpperCase();
    }

    supply.searchKey = normalizeKey(supply.type, supply.name, supply.specification, supply.oemCode);
    await supply.save();

    return res.status(200).json({
      message: "Insumo actualizado",
      supply: serializeSupply(supply),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating supply" });
  }
}

async function importExcel(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const files = Array.isArray(req.files) ? req.files : (req.file ? [req.file] : []);
    if (!files.length) {
      return res.status(400).json({ message: "Sube al menos un archivo Excel (.xlsx)" });
    }

    const results = [];
    for (const file of files) {
      const summary = await importCotizadorWorkbook(file.buffer, file.originalname || "archivo.xlsx");
      results.push(summary);
    }

    return res.status(200).json({
      message: `Importación completada (${results.length} archivo${results.length === 1 ? "" : "s"})`,
      results,
      totals: results.reduce((acc, item) => {
        acc.vehiclesCreated += item.vehiclesCreated;
        acc.vehiclesUpdated += item.vehiclesUpdated;
        acc.suppliesCreated += item.suppliesCreated;
        acc.suppliesReused += item.suppliesReused;
        return acc;
      }, {
        vehiclesCreated: 0,
        vehiclesUpdated: 0,
        suppliesCreated: 0,
        suppliesReused: 0,
      }),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error importing excel" });
  }
}

const AI_STOPWORDS = new Set([
  "me", "mi", "mis", "un", "una", "el", "la", "los", "las", "de", "del", "al", "en", "por", "para",
  "con", "sin", "que", "qué", "como", "cómo", "cual", "cuál", "este", "esta", "estos", "estas",
  "hay", "tiene", "tienen", "tenemos", "tengo", "saber", "se", "si", "sí", "no", "ya", "pero",
  "dentro", "necesario", "necesarios", "hacer", "hacerle", "pueden", "puede", "podrian", "podrían",
  "preguntan", "pregunta", "mantenimiento", "preventivo", "servicio", "stock", "insumo", "insumos",
  "aceite", "filtro", "precio", "cotizar", "carro", "carros", "vehiculo", "vehículo", "vehiculos",
  "año", "ano", "version", "versión", "motor", "modelo", "marca", "tambien", "también", "solo",
  "entre", "sobre", "hacia", "desde", "hasta", "muy", "mas", "más", "menos", "o", "y", "e", "u",
  "the", "a", "an", "of", "for", "to", "is", "are", "do", "does", "have", "has", "with", "without",
]);

const BRAND_ALIASES = [
  { key: "mercedes", aliases: ["mercedes", "mercedesbenz", "mercedes-benz", "benz", "mb"] },
  { key: "toyota", aliases: ["toyota"] },
  { key: "ford", aliases: ["ford"] },
  { key: "chevrolet", aliases: ["chevrolet", "chevy"] },
  { key: "jeep", aliases: ["jeep"] },
  { key: "lexus", aliases: ["lexus"] },
  { key: "nissan", aliases: ["nissan"] },
  { key: "bmw", aliases: ["bmw"] },
  { key: "audi", aliases: ["audi"] },
  { key: "honda", aliases: ["honda"] },
  { key: "mazda", aliases: ["mazda"] },
  { key: "land rover", aliases: ["landrover", "land rover", "range rover", "rangerover"] },
];

const MERCEDES_SERIES = [
  "slk", "slc", "clk", "cla", "cls", "gla", "glb", "glc", "gle", "gls", "amg", "maybach",
];

function compactText(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function tokenizeAiQuery(query) {
  return normalizeText(query)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !AI_STOPWORDS.has(token));
}

function extractYearFromQuery(query) {
  const match = String(query || "").match(/\b((?:19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function extractBrandFromQuery(query) {
  const compact = compactText(query);
  for (const brand of BRAND_ALIASES) {
    if (brand.aliases.some((alias) => compact.includes(compactText(alias)))) {
      return brand.key;
    }
  }
  return "";
}

function extractModelHints(query) {
  const raw = normalizeText(query).toLowerCase();
  const hints = [];
  const seen = new Set();

  function pushHint(series, number = "", required = true) {
    const cleanSeries = compactText(series);
    const cleanNumber = compactText(number);
    // Permite series de 1 letra solo si traen número (C200, A200, E350...).
    if (!cleanSeries) {
      return;
    }
    if (cleanSeries.length < 2 && !cleanNumber) {
      return;
    }
    if (cleanSeries.length === 1 && !/^[a-z]$/i.test(cleanSeries)) {
      return;
    }
    const key = `${cleanSeries}|${cleanNumber}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    hints.push({ series: cleanSeries, number: cleanNumber, required });
  }

  for (const series of MERCEDES_SERIES) {
    const regex = new RegExp(`\\b${series}\\s*-?\\s*(\\d{2,3}[a-z]?)?\\b`, "gi");
    let match = regex.exec(raw);
    while (match) {
      pushHint(series, match[1] || "", true);
      match = regex.exec(raw);
    }
  }

  const slMatch = raw.match(/\bsl\s*-?\s*(\d{2,3}[a-z]?)\b/i);
  if (slMatch) {
    pushHint("sl", slMatch[1], true);
  }

  const compactCodes = raw.matchAll(/\b([a-z]{1,3})\s*-?\s*(\d{2,3}[a-z]?)\b/gi);
  for (const match of compactCodes) {
    const series = compactText(match[1]);
    const number = compactText(match[2]);
    if (!series || !number) {
      continue;
    }
    if (AI_STOPWORDS.has(series) || /^(w|sae|api|oem)$/i.test(series)) {
      continue;
    }
    pushHint(series, number, true);
  }

  const namedModels = raw.matchAll(/\b(fortuner|prado|rav4|corolla|camry|hilux|tacoma|tundra|sequoia|4runner|landcruiser|land\s*cruiser|mustang|f150|explorer|escape|ranger|wrangler|cherokee|compass|pathfinder|xtrail|x-trail|civic|crv|cr-v|accord|pilot|cx5|cx-5|cx30|cx-30|mazda3|mazda6|x1|x3|x5|x6|x7|a3|a4|a5|a6|q3|q5|q7|serie\s*3|serie\s*5|clase\s*[a-z])\b/gi);
  for (const match of namedModels) {
    pushHint(match[1].replace(/\s+/g, ""), "", true);
  }

  return hints;
}

function vehicleSearchText(vehicle) {
  return normalizeText([
    vehicle.brand,
    vehicle.model,
    vehicle.variantLabel,
    vehicle.engineCode,
  ].filter(Boolean).join(" ")).toLowerCase();
}

function textHasModelHint(text, series, number = "") {
  const raw = normalizeText(text).toLowerCase();
  if (!raw || !series) {
    return false;
  }

  const seriesSafe = escapeRegex(series);
  const numberSafe = escapeRegex(number || "");

  if (numberSafe) {
    const glued = new RegExp(`(?:^|[^a-z0-9])${seriesSafe}${numberSafe}\\b`, "i");
    const spaced = new RegExp(`(?:^|[^a-z0-9])${seriesSafe}\\s*-?\\s*${numberSafe}\\b`, "i");
    if (glued.test(raw) || spaced.test(raw)) {
      return true;
    }
  }

  // Evita que "sl" coincida dentro de "gls"/"clase".
  const seriesPattern = new RegExp(`(?:^|[^a-z0-9])${seriesSafe}(?=$|[^a-z]|\\d)`, "i");
  return seriesPattern.test(raw);
}

function parseVehicleQuery(query) {
  const brand = extractBrandFromQuery(query);
  const year = extractYearFromQuery(query);
  const modelHints = extractModelHints(query);
  const tokens = tokenizeAiQuery(query).filter((token) => {
    if (brand && compactText(brand).includes(token)) {
      return false;
    }
    if (year && String(year) === token) {
      return false;
    }
    return true;
  });

  return {
    brand,
    year,
    modelHints,
    tokens,
    looksLikeVehicle: Boolean(brand || modelHints.length || year),
  };
}

function scoreVehicleMatch(vehicle, queryInfo) {
  const searchText = vehicleSearchText(vehicle);
  const brandCompact = compactText(vehicle.brand || "");

  if (!searchText) {
    return 0;
  }

  if (queryInfo.brand) {
    const wantedBrand = compactText(queryInfo.brand);
    if (!brandCompact.includes(wantedBrand) && !compactText(searchText).includes(wantedBrand)) {
      return 0;
    }
  }

  if (queryInfo.year) {
    const from = Number(vehicle.yearFrom || 0);
    const to = Number(vehicle.yearTo || vehicle.yearFrom || 0);
    if (!Number.isFinite(from) || !Number.isFinite(to) || queryInfo.year < from || queryInfo.year > to) {
      return 0;
    }
  }

  const requiredHints = (queryInfo.modelHints || []).filter((hint) => hint.required);
  if (requiredHints.length) {
    let matchedRequired = 0;
    for (const hint of requiredHints) {
      if (textHasModelHint(searchText, hint.series, hint.number)) {
        matchedRequired += 1;
      }
    }

    if (!matchedRequired) {
      return 0;
    }
  } else if (!queryInfo.brand) {
    // Sin marca ni modelo claro: no adivinar con tokens sueltos tipo "200".
    return 0;
  }

  let score = 10;
  if (queryInfo.brand) score += 8;
  if (queryInfo.year) score += 6;

  for (const hint of requiredHints) {
    if (textHasModelHint(searchText, hint.series, hint.number)) {
      score += hint.number ? 28 : 16;
    } else if (textHasModelHint(searchText, hint.series, "")) {
      score += 10;
    }
  }

  for (const token of queryInfo.tokens || []) {
    if (token.length < 3) {
      continue;
    }
    if (compactText(searchText).includes(compactText(token))) {
      score += 2;
    }
  }

  return score;
}

function describeVehicleSearch(queryInfo, question) {
  const parts = [];
  if (queryInfo.brand) {
    parts.push(queryInfo.brand);
  }
  if (queryInfo.modelHints?.length) {
    parts.push(
      queryInfo.modelHints
        .map((hint) => `${hint.series.toUpperCase()}${hint.number ? ` ${hint.number.toUpperCase()}` : ""}`)
        .join(" / ")
    );
  }
  if (queryInfo.year) {
    parts.push(String(queryInfo.year));
  }
  return parts.length ? parts.join(" ") : normalizeText(question);
}

function buildSuggestedPrice(parts) {
  let total = 0;
  let pricedParts = 0;

  for (const part of parts) {
    const unitCost = Number(part.supply?.unitCost || 0);
    if (unitCost > 0) {
      total += unitCost * Number(part.quantityValue || 1);
      pricedParts += 1;
    }
  }

  return {
    total: Math.round(total),
    pricedParts,
    hasPricing: pricedParts > 0,
  };
}

async function askCotizadorAi(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const question = normalizeText(req.body.question || req.body.q);
    if (!question) {
      return res.status(400).json({ message: "Escribe una pregunta" });
    }

    const lower = question.toLowerCase();
    const queryInfo = parseVehicleQuery(question);
    const searchedLabel = describeVehicleSearch(queryInfo, question);
    const oilMatch = lower.match(/\b(\d+\s*w[-\s]?\d+)\b/i);
    const looksLikeSupplyQuery = Boolean(
      !queryInfo.looksLikeVehicle
      && (oilMatch || /filtro|aceite|oem|90915|17801|87139|90430/.test(lower))
    );

    if (looksLikeSupplyQuery) {
      const query = oilMatch ? oilMatch[1].replace(/\s+/g, "") : question;
      const regex = new RegExp(escapeRegex(query).replace(/w/i, "w[-\\s]?"), "i");
      const supplies = await CotizadorSupply.find({
        $or: [
          { specification: regex },
          { oemCode: regex },
          { searchKey: regex },
        ],
      }).lean();

      const supplyIds = supplies.map((item) => item._id);
      const vehicles = await CotizadorVehicle.find({ "parts.supply": { $in: supplyIds } })
        .select("brand model variantLabel engineCode yearFrom yearTo")
        .lean();

      return res.status(200).json({
        mode: "supply_lookup",
        answer: supplies.length
          ? `Encontré ${supplies.length} insumo(s) relacionados y ${vehicles.length} vehículo(s) compatibles.`
          : "No encontré insumos con esa referencia en el cotizador.",
        supplies: supplies.map(serializeSupply),
        vehicles: vehicles.map((vehicle) => ({
          id: String(vehicle._id),
          label: `${vehicle.brand} ${vehicle.model} · ${vehicle.variantLabel}`,
          yearFrom: vehicle.yearFrom,
          yearTo: vehicle.yearTo,
        })),
      });
    }

    const vehicles = await CotizadorVehicle.find({})
      .populate("parts.supply")
      .lean();

    if (queryInfo.brand && !queryInfo.modelHints.length) {
      const related = vehicles
        .filter((vehicle) => compactText(vehicle.brand).includes(compactText(queryInfo.brand)))
        .slice(0, 8)
        .map((vehicle) => ({
          id: String(vehicle._id),
          label: `${vehicle.brand} ${vehicle.model} · ${vehicle.variantLabel}`,
          yearFrom: vehicle.yearFrom,
          yearTo: vehicle.yearTo,
        }));

      return res.status(200).json({
        mode: "no_vehicle",
        searched: searchedLabel,
        answer: related.length
          ? `Indicaste ${queryInfo.brand}, pero necesito el modelo/versión exacta (ej. SLK 200, C200, GLE 450). Estas son algunas versiones de ${queryInfo.brand} que sí están cargadas:`
          : `Indicaste ${queryInfo.brand}, pero no hay versiones cargadas de esa marca. Súbelas en Excel o dime otro modelo.`,
        relatedVehicles: related,
        vehicles: [],
        analyses: [],
      });
    }

    const ranked = vehicles
      .map((vehicle) => ({ vehicle, score: scoreVehicleMatch(vehicle, queryInfo) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const topScore = ranked[0]?.score || 0;
    const selected = ranked
      .filter((item) => item.score >= Math.max(18, topScore - 8))
      .slice(0, 3)
      .map((item) => item.vehicle);

    if (!selected.length) {
      const related = queryInfo.brand
        ? vehicles
          .filter((vehicle) => compactText(vehicle.brand).includes(compactText(queryInfo.brand)))
          .slice(0, 6)
          .map((vehicle) => ({
            id: String(vehicle._id),
            label: `${vehicle.brand} ${vehicle.model} · ${vehicle.variantLabel}`,
            yearFrom: vehicle.yearFrom,
            yearTo: vehicle.yearTo,
          }))
        : [];

      const answer = related.length
        ? `No tenemos cargado ${searchedLabel} en el cotizador. No te voy a responder con otro carro. De ${queryInfo.brand} sí hay otras versiones cargadas (abajo); si quieres, pregunta por una de esas o súbelo en Excel.`
        : `No tenemos cargado ${searchedLabel} en el cotizador. Dime marca + modelo/versión + año exactos, o súbelo en Excel para poder revisar insumos.`;

      return res.status(200).json({
        mode: "no_vehicle",
        searched: searchedLabel,
        answer,
        relatedVehicles: related,
        vehicles: [],
        analyses: [],
      });
    }

    const settings = await getOrCreateSettings();
    const analyses = selected.map((vehicle) => {
      const quote = buildQuoteForVehicle(vehicle, settings);
      const partsCost = Number(quote.pricing?.partsCost || 0);
      const laborPrice = Number(quote.pricing?.laborPrice || 0);
      const total = Number(quote.pricing?.total || 0);
      const hasPricing = partsCost > 0 || laborPrice > 0;

      return {
        vehicle: quote.vehicle,
        canService: quote.canService,
        missingCount: quote.missing.length,
        parts: quote.parts,
        missing: quote.missing,
        suggestedPrice: {
          partsCost,
          laborMecanico: Number(quote.pricing?.laborMecanico || 0),
          laborAlistamiento: Number(quote.pricing?.laborAlistamiento || 0),
          laborPrice,
          total,
          hasPricing,
          currency: quote.pricing?.currency || "COP",
        },
      };
    });

    const best = analyses[0];
    const vehicleLabel = `${best.vehicle.brand} ${best.vehicle.model} · ${best.vehicle.variantLabel}`;
    const priceText = best.suggestedPrice.hasPricing
      ? ` Precio sugerido: $${best.suggestedPrice.total.toLocaleString("es-CO")} (insumos $${best.suggestedPrice.partsCost.toLocaleString("es-CO")} + mantenimiento $${Number(best.suggestedPrice.laborMecanico || 0).toLocaleString("es-CO")} + alistamiento $${Number(best.suggestedPrice.laborAlistamiento || 0).toLocaleString("es-CO")}).`
      : " Aún no hay costos/mano de obra cargados.";
    const answer = best.canService
      ? `Para ${vehicleLabel}: sí, con el stock actual se puede proyectar el mantenimiento preventivo.${priceText}`
      : `Para ${vehicleLabel}: la ficha sí está cargada, pero faltan ${best.missingCount} insumo(s) en stock. Las referencias ya existen; cuando repongas inventario se puede confirmar el servicio.${priceText}`;

    return res.status(200).json({
      mode: "vehicle_service_check",
      searched: searchedLabel,
      answer,
      analyses,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error in AI assistant" });
  }
}

async function buildClientQuotePayload(req) {
  const vehicleId = normalizeText(req.body.vehicleId || req.query.vehicleId);
  const brand = normalizeText(req.body.brand || req.query.brand);
  const model = normalizeText(req.body.model || req.query.model);
  const year = Number(req.body.year || req.query.year);
  const clientName = normalizeText(req.body.clientName);
  const clientDocument = normalizeText(req.body.clientDocument);
  const clientEmail = normalizeText(req.body.clientEmail).toLowerCase();
  const clientPhone = normalizeText(req.body.clientPhone);
  const quoteDate = normalizeText(req.body.quoteDate) || new Date().toISOString().slice(0, 10);

  const { quote, settings } = await loadQuoteVehicle({
    vehicleId,
    brand,
    model,
    year: Number.isFinite(year) ? year : NaN,
  });

  const totals = buildQuoteTotals(quote.pricing?.salePrice ?? quote.pricing?.costTotal);
  const items = buildClientServiceItems(quote);
  const vehicleLabel = buildVehicleLabel(quote, Number.isFinite(year) && year > 0 ? year : "");

  return {
    quote,
    settings,
    clientName,
    clientDocument,
    clientEmail,
    clientPhone,
    quoteDate,
    year: Number.isFinite(year) && year > 0 ? year : "",
    logoUrl: resolveLogoUrl(req, { absolute: false }),
    logoUrlAbsolute: resolveLogoUrl(req, { forEmail: true }),
    totals,
    items,
    vehicleLabel,
  };
}

async function previewQuoteDocument(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const payload = await buildClientQuotePayload(req);
    const html = buildQuoteDocumentHtml({
      ...payload,
      logoUrl: payload.logoUrl || COMPANY.logoPath,
    });

    return res.status(200).json({
      html,
      totals: payload.totals,
      items: payload.items,
      vehicle: payload.vehicleLabel,
      company: COMPANY,
      client: {
        name: payload.clientName,
        document: payload.clientDocument,
        email: payload.clientEmail,
        phone: payload.clientPhone,
        date: payload.quoteDate,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error building quote document" });
  }
}

async function sendQuoteEmail(req, res) {
  try {
    if (!canAccessLatam(req.user)) {
      return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
    }

    const payload = await buildClientQuotePayload(req);

    if (!payload.clientName) {
      return res.status(400).json({ message: "Indica el nombre o razón social del cliente" });
    }
    if (!payload.clientDocument) {
      return res.status(400).json({ message: "Indica la cédula o NIT del cliente" });
    }
    if (!payload.clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.clientEmail)) {
      return res.status(400).json({ message: "Indica un correo válido del cliente" });
    }
    if (!payload.quoteDate) {
      return res.status(400).json({ message: "Indica la fecha de la cotización" });
    }

    const htmlContent = buildQuoteEmailHtml({
      ...payload,
      logoUrl: payload.logoUrlAbsolute || resolveLogoUrl(req, { forEmail: true }),
    });
    const vehicleTitle = `${payload.vehicleLabel.brand} ${payload.vehicleLabel.model}`.trim();
    const addToMarketing = !(
      req.body.addToMarketing === false
      || req.body.addToMarketing === "false"
      || req.body.addToMarketing === 0
      || req.body.addToMarketing === "0"
    );

    const pdfBuffer = await buildQuotePdfBuffer(payload);
    const pdfFileName = buildQuotePdfFileName(payload);

    await sendBrevoEmail({
      toEmail: payload.clientEmail,
      toName: payload.clientName,
      subject: `Cotización de mantenimiento · ${vehicleTitle} | Global Imports`,
      htmlContent,
      senderName: "Global Imports",
      senderEmail: "info@globalimportsus.com",
      attachments: [
        {
          name: pdfFileName,
          content: pdfBuffer,
        },
      ],
    });

    let marketingSaved = false;
    if (addToMarketing) {
      const followUpAt = new Date();
      followUpAt.setMonth(followUpAt.getMonth() + 6);
      await CotizadorMarketingLead.findOneAndUpdate(
        { email: payload.clientEmail },
        {
          $set: {
            name: payload.clientName,
            email: payload.clientEmail,
            phone: payload.clientPhone || "",
            identification: payload.clientDocument || "",
            vehicleLabel: vehicleTitle,
            followUpAt,
            source: "cotizador",
            createdBy: req.user?._id || req.user?.id || null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      marketingSaved = true;
    }

    return res.status(200).json({
      message: `Cotización enviada a ${payload.clientEmail}`,
      totals: payload.totals,
      clientEmail: payload.clientEmail,
      marketingSaved,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Error sending quote email" });
  }
}

module.exports = {
  getCotizadorOverview,
  getPricingBoard,
  getQuote,
  previewQuoteDocument,
  sendQuoteEmail,
  updateSettings,
  updateVehiclePricing,
  listSupplies,
  exportSuppliesXlsx,
  createSupply,
  updateSupply,
  importExcel,
  askCotizadorAi,
  parseVehicleQuery,
  scoreVehicleMatch,
  TYPE_LABELS,
};
