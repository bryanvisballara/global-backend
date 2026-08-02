const CotizadorSupply = require("../models/CotizadorSupply");
const CotizadorVehicle = require("../models/CotizadorVehicle");
const CotizadorSettings = require("../models/CotizadorSettings");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(...parts) {
  return parts
    .map((part) => normalizeText(part).toLowerCase())
    .filter(Boolean)
    .join(" | ");
}

/** Tasa implícita del listado Sequoia/Tundra: $152 USD = $478.952 COP */
const USD_TO_COP = 3151;

/**
 * Costos unitarios técnicos del paquete (USD del listado → COP).
 * El aceite y filtros se multiplican por la cantidad de cada ficha.
 */
const TECHNICAL_UNIT_COSTS_COP = {
  oilPerLiter: Math.round(7 * USD_TO_COP), // 7 USD/L
  engineAirFilter: Math.round(28 * USD_TO_COP), // 28 USD/und
  oilFilterWithSeal: Math.round(15 * USD_TO_COP), // 15 USD combo filtro+sello
  cabinAirFilter: Math.round(27 * USD_TO_COP), // total listado $27
  drainPlugGasket: 0, // incluido en filtro aceite + sello
};

/** Mano de obra del servicio (ya en COP en el listado). */
const LABOR_PACKAGE_COP = {
  alistamiento: 30000,
  mecanico: 150000,
  get total() {
    return this.alistamiento + this.mecanico;
  },
};

/**
 * Extras de taller que entran en TODO mantenimiento (totales fijos del listado).
 * Cantidad siempre 1; costo = total USD × tasa.
 */
const SERVICE_EXTRAS = [
  {
    code: "SVC-HIDRATACION",
    name: "Hidratación cojinería",
    specification: "Hidratación cojinería",
    unitCostUsd: 2,
  },
  {
    code: "SVC-PARTES-NEGRAS",
    name: "Protección partes negras",
    specification: "Protección partes negras",
    unitCostUsd: 1,
  },
  {
    code: "SVC-AMBIENTADOR",
    name: "Ambientador",
    specification: "Ambientador",
    unitCostUsd: 3,
  },
  {
    code: "SVC-LIMPIA-PARABRISAS",
    name: "Limpia parabrisas",
    specification: "Limpia parabrisas",
    unitCostUsd: 0.1,
  },
  {
    code: "SVC-SHAMPOO",
    name: "Shampoo lavado",
    specification: "Shampoo lavado",
    unitCostUsd: 1,
  },
  {
    code: "SVC-AGUA",
    name: "Servicio de agua",
    specification: "Servicio de agua",
    unitCostUsd: 5,
  },
].map((item) => ({
  ...item,
  unitCost: Math.round(item.unitCostUsd * USD_TO_COP),
  type: "other",
  unit: "und",
  ignoreStock: true,
}));

async function upsertServiceExtraSupply(extra) {
  const searchKey = normalizeKey("other", extra.code, extra.specification);
  let supply = await CotizadorSupply.findOne({
    $or: [
      { oemCode: extra.code },
      { searchKey },
      { type: "other", specification: extra.specification },
    ],
  });

  if (!supply) {
    supply = new CotizadorSupply({
      type: "other",
      name: extra.name,
      specification: extra.specification,
      oemCode: extra.code,
      provider: "Taller Global Imports",
      unit: "und",
      stock: 0,
      notes: "Incluido en todo mantenimiento preventivo (paquete taller).",
    });
  }

  supply.name = extra.name;
  supply.specification = extra.specification;
  supply.oemCode = extra.code;
  supply.unitCost = extra.unitCost;
  supply.unit = "und";
  supply.ignoreStock = true;
  supply.provider = supply.provider || "Taller Global Imports";
  supply.notes = "Incluido en todo mantenimiento preventivo (paquete taller).";
  supply.searchKey = searchKey;
  await supply.save();
  return supply;
}

function buildExtraPart(supply) {
  return {
    supply: supply._id,
    type: "other",
    quantityLabel: "1",
    quantityValue: 1,
    notes: "Paquete taller (fijo)",
  };
}

async function ensureServiceExtrasOnVehicle(vehicleDoc, extraSupplies) {
  if (!vehicleDoc) {
    return { added: 0 };
  }

  const existingIds = new Set(
    (vehicleDoc.parts || []).map((part) => String(part.supply?._id || part.supply || ""))
  );
  let added = 0;

  for (const supply of extraSupplies) {
    const id = String(supply._id);
    if (existingIds.has(id)) {
      continue;
    }
    vehicleDoc.parts.push(buildExtraPart(supply));
    existingIds.add(id);
    added += 1;
  }

  if (added > 0) {
    await vehicleDoc.save();
  }

  return { added };
}

async function applyTechnicalUnitCosts() {
  const oilResult = await CotizadorSupply.updateMany(
    { type: "oil" },
    { $set: { unitCost: TECHNICAL_UNIT_COSTS_COP.oilPerLiter, unit: "L" } }
  );
  const airResult = await CotizadorSupply.updateMany(
    { type: "engine_air_filter" },
    { $set: { unitCost: TECHNICAL_UNIT_COSTS_COP.engineAirFilter, unit: "und" } }
  );
  const oilFilterResult = await CotizadorSupply.updateMany(
    { type: "oil_filter" },
    {
      $set: {
        unitCost: TECHNICAL_UNIT_COSTS_COP.oilFilterWithSeal,
        unit: "und",
        notes: "Incluye sello/empaque del tapón según listado taller.",
      },
    }
  );
  const cabinResult = await CotizadorSupply.updateMany(
    { type: "cabin_air_filter" },
    { $set: { unitCost: TECHNICAL_UNIT_COSTS_COP.cabinAirFilter, unit: "und" } }
  );
  const gasketResult = await CotizadorSupply.updateMany(
    { type: "drain_plug_gasket" },
    {
      $set: {
        unitCost: TECHNICAL_UNIT_COSTS_COP.drainPlugGasket,
        unit: "und",
        ignoreStock: true,
        notes: "Costo incluido en filtro de aceite + sello del paquete taller.",
      },
    }
  );

  return {
    oil: oilResult.modifiedCount,
    engineAir: airResult.modifiedCount,
    oilFilter: oilFilterResult.modifiedCount,
    cabin: cabinResult.modifiedCount,
    gasket: gasketResult.modifiedCount,
  };
}

async function applyLaborPackage(settingsDoc) {
  const settings = settingsDoc || (await CotizadorSettings.findOne({ key: "default" })) || new CotizadorSettings({ key: "default" });
  settings.laborPrice = LABOR_PACKAGE_COP.mecanico;
  settings.laborAlistamiento = LABOR_PACKAGE_COP.alistamiento;
  settings.currency = "COP";
  settings.notes = normalizeText(
    `Mano de obra mantenimiento (mecánico) $${LABOR_PACKAGE_COP.mecanico.toLocaleString("es-CO")} + alistamiento $${LABOR_PACKAGE_COP.alistamiento.toLocaleString("es-CO")}. Materiales convertidos USD→COP con tasa ${USD_TO_COP} (listado Sequoia/Tundra).`
  );
  await settings.save();
  return settings;
}

async function syncMaintenanceServicePackage() {
  const extraSupplies = [];
  for (const extra of SERVICE_EXTRAS) {
    extraSupplies.push(await upsertServiceExtraSupply(extra));
  }

  const technical = await applyTechnicalUnitCosts();
  const settings = await applyLaborPackage();

  const vehicles = await CotizadorVehicle.find({});
  let vehiclesUpdated = 0;
  let partsAdded = 0;

  for (const vehicle of vehicles) {
    const result = await ensureServiceExtrasOnVehicle(vehicle, extraSupplies);
    if (result.added > 0) {
      vehiclesUpdated += 1;
      partsAdded += result.added;
    }
  }

  return {
    usdToCop: USD_TO_COP,
    laborPrice: LABOR_PACKAGE_COP.mecanico,
    laborAlistamiento: LABOR_PACKAGE_COP.alistamiento,
    laborBreakdown: {
      alistamiento: LABOR_PACKAGE_COP.alistamiento,
      mecanico: LABOR_PACKAGE_COP.mecanico,
    },
    technicalUnitCosts: TECHNICAL_UNIT_COSTS_COP,
    extras: extraSupplies.map((supply) => ({
      id: String(supply._id),
      specification: supply.specification,
      unitCost: supply.unitCost,
    })),
    technicalUpdated: technical,
    vehiclesUpdated,
    partsAdded,
    settings: {
      laborPrice: settings.laborPrice,
      laborAlistamiento: settings.laborAlistamiento,
      currency: settings.currency,
      notes: settings.notes,
    },
  };
}

module.exports = {
  USD_TO_COP,
  TECHNICAL_UNIT_COSTS_COP,
  LABOR_PACKAGE_COP,
  SERVICE_EXTRAS,
  upsertServiceExtraSupply,
  ensureServiceExtrasOnVehicle,
  syncMaintenanceServicePackage,
  applyTechnicalUnitCosts,
  applyLaborPackage,
};
