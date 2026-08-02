const XLSX = require("xlsx");
const CotizadorSupply = require("../models/CotizadorSupply");
const CotizadorVehicle = require("../models/CotizadorVehicle");

const ITEM_TYPE_MAP = [
  { match: /aceite\s*motor|engine\s*oil/i, type: "oil", name: "Aceite motor" },
  { match: /filtro\s*aceite|oil\s*filter/i, type: "oil_filter", name: "Filtro aceite" },
  { match: /empaque|tap[oó]n|drain\s*plug|gasket|sello/i, type: "drain_plug_gasket", name: "Empaque tapón" },
  { match: /filtro\s*aire\s*motor|engine\s*air/i, type: "engine_air_filter", name: "Filtro aire motor" },
  { match: /filtro\s*cabina|aire\s*acondicionado|cabin|cabin\s*filter/i, type: "cabin_air_filter", name: "Filtro cabina" },
];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKey(...parts) {
  return parts
    .map((part) => normalizeText(part).toLowerCase())
    .filter(Boolean)
    .join(" | ");
}

function resolveItemType(itemLabel) {
  const label = normalizeText(itemLabel);
  for (const entry of ITEM_TYPE_MAP) {
    if (entry.match.test(label)) {
      return entry;
    }
  }
  return { type: "other", name: label || "Insumo" };
}

function parseQuantity(quantityLabel) {
  const raw = normalizeText(quantityLabel);
  if (!raw) {
    return { quantityLabel: "1", quantityValue: 1, unit: "und" };
  }

  const match = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
  const quantityValue = match ? Number(match[1]) : 1;
  const unit = /l\b|lit/i.test(raw) ? "L" : "und";
  return {
    quantityLabel: raw,
    quantityValue: Number.isFinite(quantityValue) ? quantityValue : 1,
    unit,
  };
}

function parseVariantHeader(headerText, fallbackBrand = "", fallbackModel = "") {
  const header = normalizeText(headerText);
  const yearMatch = header.match(/\((\d{4})\s*[-–]\s*(\d{4}|\+)?\)/);
  const yearFrom = yearMatch ? Number(yearMatch[1]) : null;
  const yearTo = yearMatch
    ? (yearMatch[2] === "+" || !yearMatch[2] ? yearFrom : Number(yearMatch[2]))
    : null;

  const withoutYears = header.replace(/\([^)]*\)/g, "").trim();
  const tokens = withoutYears.split(/\s+/).filter(Boolean);
  let engineCode = "";
  const engineToken = tokens.find((token) => /^[0-9A-Z]{2,}(-[A-Z0-9]+)+$/i.test(token) || /^[0-9][A-Z]{2,}(-[A-Z0-9]+)?$/i.test(token));
  if (engineToken) {
    engineCode = engineToken.toUpperCase();
  }

  let brand = normalizeText(fallbackBrand);
  let model = normalizeText(fallbackModel);

  if (!brand && tokens.length) {
    brand = tokens[0];
  }

  if (!model) {
    const modelTokens = tokens.filter((token) => token.toUpperCase() !== engineCode && token.toUpperCase() !== brand.toUpperCase());
    model = modelTokens.join(" ") || withoutYears || "Modelo";
  }

  return {
    variantLabel: header,
    brand: brand || "GENÉRICO",
    model: model || withoutYears || "Modelo",
    engineCode,
    yearFrom: Number.isFinite(yearFrom) ? yearFrom : null,
    yearTo: Number.isFinite(yearTo) ? yearTo : null,
  };
}

function inferBrandModelFromSheet(sheetName, fileName = "") {
  const source = normalizeText(sheetName) || normalizeText(fileName).replace(/\.xlsx?$/i, "");
  const cleaned = source
    .replace(/mantenimiento|base|taller|premium|global\s*imports/gi, "")
    .replace(/[_-]+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return { brand: "GENÉRICO", model: "Modelo" };
  }

  const joined = tokens.join(" ");
  const multiWordBrands = [
    ["Land Rover", 2],
    ["Range Rover", 2],
    ["Mercedes Benz", 2],
    ["Alfa Romeo", 2],
  ];

  for (const [brand, size] of multiWordBrands) {
    if (new RegExp(`^${brand}\\b`, "i").test(joined)) {
      return {
        brand,
        model: tokens.slice(size).join(" ") || brand,
      };
    }
  }

  if (tokens.length === 1) {
    return { brand: tokens[0], model: tokens[0] };
  }

  return {
    brand: tokens[0],
    model: tokens.slice(1).join(" "),
  };
}

function isHeaderRow(row) {
  const first = normalizeText(row?.[0]).toUpperCase();
  const second = normalizeText(row?.[1]).toUpperCase();
  return first === "ITEM" && (second.includes("ESPEC") || second.includes("SPEC"));
}

function isVariantHeader(row) {
  const first = normalizeText(row?.[0]);
  if (!first) {
    return false;
  }
  if (isHeaderRow(row)) {
    return false;
  }
  const restEmpty = [1, 2, 3, 4, 5].every((index) => !normalizeText(row?.[index]));
  return restEmpty && first.length > 3 && !/^taller/i.test(first);
}

async function upsertSupply({ type, name, specification, provider, notes, link, unit }) {
  const oemCode = type === "oil" ? "" : normalizeText(specification).toUpperCase();
  const normalizedSpec = normalizeText(specification);
  const searchKey = normalizeKey(type, name, normalizedSpec, oemCode);

  let existing = null;
  if (type === "oil") {
    existing = await CotizadorSupply.findOne({ type, specification: normalizedSpec });
  } else if (oemCode) {
    existing = await CotizadorSupply.findOne({
      type,
      $or: [{ oemCode }, { specification: normalizedSpec }],
    });
  } else {
    existing = await CotizadorSupply.findOne({ type, specification: normalizedSpec });
  }

  if (existing) {
    existing.name = name || existing.name;
    existing.provider = provider || existing.provider;
    existing.notes = notes || existing.notes;
    existing.link = link || existing.link;
    existing.unit = unit || existing.unit;
    existing.searchKey = searchKey;
    await existing.save();
    return { supply: existing, created: false };
  }

  const supply = await CotizadorSupply.create({
    type,
    name,
    specification: normalizeText(specification),
    oemCode,
    provider: normalizeText(provider),
    notes: normalizeText(notes),
    link: normalizeText(link),
    stock: 0,
    unitCost: 0,
    unit: unit || (type === "oil" ? "L" : "und"),
    searchKey,
  });

  return { supply, created: true };
}

async function upsertVehicle({ brand, model, variantLabel, engineCode, yearFrom, yearTo, sourceFile, notes, parts }) {
  const searchKey = normalizeKey(brand, model, engineCode, variantLabel, yearFrom, yearTo);
  let vehicle = await CotizadorVehicle.findOne({
    brand,
    model,
    variantLabel,
    engineCode,
    yearFrom,
    yearTo,
  });

  if (!vehicle) {
    vehicle = new CotizadorVehicle({
      brand,
      model,
      variantLabel,
      engineCode,
      yearFrom,
      yearTo,
      sourceFile,
      notes,
      parts: [],
      searchKey,
    });
  }

  vehicle.sourceFile = sourceFile || vehicle.sourceFile;
  vehicle.notes = notes || vehicle.notes;
  vehicle.searchKey = searchKey;
  vehicle.parts = parts;
  await vehicle.save();
  return vehicle;
}

function extractSheetVariants(rows, sheetName, fileName) {
  const inferred = inferBrandModelFromSheet(sheetName, fileName);
  const variants = [];
  let current = null;
  let sheetNotes = [];

  for (const row of rows) {
    const first = normalizeText(row?.[0]);
    if (!first) {
      continue;
    }

    if (isVariantHeader(row)) {
      if (current) {
        variants.push(current);
      }
      const parsed = parseVariantHeader(first, inferred.brand, inferred.model);
      current = {
        ...parsed,
        parts: [],
      };
      continue;
    }

    if (!current || isHeaderRow(row)) {
      continue;
    }

    const itemLabel = first;
    const specification = normalizeText(row?.[1]);
    if (!specification) {
      continue;
    }

    const typeInfo = resolveItemType(itemLabel);
    const quantityInfo = parseQuantity(row?.[2]);
    current.parts.push({
      type: typeInfo.type,
      name: typeInfo.name,
      specification,
      quantityLabel: quantityInfo.quantityLabel,
      quantityValue: quantityInfo.quantityValue,
      unit: quantityInfo.unit,
      notes: normalizeText(row?.[3]),
      provider: normalizeText(row?.[4]),
      link: normalizeText(row?.[5]),
    });
  }

  if (current) {
    variants.push(current);
  }

  return { variants, sheetNotes, inferred };
}

async function importCotizadorWorkbook(bufferOrPath, fileName = "archivo.xlsx") {
  const workbook = typeof bufferOrPath === "string"
    ? XLSX.readFile(bufferOrPath)
    : XLSX.read(bufferOrPath, { type: "buffer" });

  const summary = {
    fileName,
    sheets: 0,
    vehiclesCreated: 0,
    vehiclesUpdated: 0,
    suppliesCreated: 0,
    suppliesReused: 0,
    variants: [],
  };

  for (const sheetName of workbook.SheetNames) {
    if (/nota/i.test(sheetName)) {
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const { variants } = extractSheetVariants(rows, sheetName, fileName);
    summary.sheets += 1;

    for (const variant of variants) {
      if (!variant.parts.length) {
        continue;
      }

      const parts = [];
      for (const part of variant.parts) {
        const { supply, created } = await upsertSupply({
          type: part.type,
          name: part.name,
          specification: part.specification,
          provider: part.provider,
          notes: part.notes,
          link: part.link,
          unit: part.unit,
        });

        if (created) {
          summary.suppliesCreated += 1;
        } else {
          summary.suppliesReused += 1;
        }

        parts.push({
          supply: supply._id,
          type: part.type,
          quantityLabel: part.quantityLabel,
          quantityValue: part.quantityValue,
          notes: part.notes,
        });
      }

      const existing = await CotizadorVehicle.findOne({
        brand: variant.brand,
        model: variant.model,
        variantLabel: variant.variantLabel,
        engineCode: variant.engineCode,
        yearFrom: variant.yearFrom,
        yearTo: variant.yearTo,
      }).select("_id");

      const vehicle = await upsertVehicle({
        brand: variant.brand,
        model: variant.model,
        variantLabel: variant.variantLabel,
        engineCode: variant.engineCode,
        yearFrom: variant.yearFrom,
        yearTo: variant.yearTo,
        sourceFile: fileName,
        notes: "",
        parts,
      });

      // Reaplica extras de taller (el upsert reemplaza parts técnicos).
      const {
        SERVICE_EXTRAS,
        upsertServiceExtraSupply,
        ensureServiceExtrasOnVehicle,
      } = require("./cotizadorServicePackage");
      const extraSupplies = [];
      for (const extra of SERVICE_EXTRAS) {
        extraSupplies.push(await upsertServiceExtraSupply(extra));
      }
      await ensureServiceExtrasOnVehicle(vehicle, extraSupplies);

      if (existing) {
        summary.vehiclesUpdated += 1;
      } else {
        summary.vehiclesCreated += 1;
      }

      summary.variants.push(variant.variantLabel);
    }
  }

  return summary;
}

module.exports = {
  importCotizadorWorkbook,
  normalizeText,
  normalizeKey,
  resolveItemType,
  parseQuantity,
};
