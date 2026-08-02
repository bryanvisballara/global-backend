const COMPANY = {
  name: "Global Imports",
  nit: "901588128",
  address: "Calle 79 # 44 - 23, Barranquilla, Atlántico, Colombia",
  phone: "3016698126",
  phoneDisplay: "301 669 8126",
  email: "info@globalimportsus.com",
  logoPath: "/logoblancoleon.png",
  whatsapp: "https://wa.me/573016698126",
};

const IVA_RATE = 0.19;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString("es-CO")}`;
}

function isUsablePublicBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/$/, "");
  if (!normalized || normalized === "*") {
    return "";
  }
  if (!/^https?:\/\//i.test(normalized)) {
    return "";
  }
  return normalized;
}

function resolvePublicBaseUrl(req) {
  const envCandidates = [
    process.env.PUBLIC_APP_URL,
    process.env.APP_BASE_URL,
    ...String(process.env.CORS_ORIGIN || "").split(","),
  ];

  for (const candidate of envCandidates) {
    const usable = isUsablePublicBaseUrl(candidate);
    if (usable) {
      return usable;
    }
  }

  if (req) {
    const host = String(req.get?.("host") || req.headers?.host || "").trim();
    if (host) {
      const proto = String(
        req.headers?.["x-forwarded-proto"]
        || req.protocol
        || "http"
      ).split(",")[0].trim() || "http";
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  return "";
}

function resolveLogoUrl(req, { absolute = false, forEmail = false } = {}) {
  if (!absolute && !forEmail) {
    return COMPANY.logoPath;
  }

  const baseUrl = resolvePublicBaseUrl(req);
  if (baseUrl && !/localhost|127\.0\.0\.1/i.test(baseUrl)) {
    return `${baseUrl}${COMPANY.logoPath}`;
  }

  // Email clients cannot load localhost assets; use production host for images.
  if (forEmail || absolute) {
    return `https://globalimports.app${COMPANY.logoPath}`;
  }

  return COMPANY.logoPath;
}

function buildQuoteTotals(salePrice) {
  const subtotal = Math.round(Number(salePrice || 0));
  const iva = Math.round(subtotal * IVA_RATE);
  const total = subtotal + iva;

  return {
    subtotal,
    iva,
    ivaRate: IVA_RATE,
    total,
    currency: "COP",
  };
}

const DETAILING_HIDE_PATTERNS = [
  /hidrataci[oó]n\s*cojiner/i,
  /partes\s*negras/i,
  /ambientador/i,
  /limpia\s*parabrisas/i,
  /shampoo\s*lavado/i,
  /servicio\s*de\s*agua/i,
  /aditivo\s*quita\s*grasas/i,
];

const DETAILING_HIDE_CODES = new Set([
  "SVC-HIDRATACION",
  "SVC-PARTES-NEGRAS",
  "SVC-AMBIENTADOR",
  "SVC-LIMPIA-PARABRISAS",
  "SVC-SHAMPOO",
  "SVC-AGUA",
]);

const DETAILING_DETAIL = "Lavado, encerado, hidratación cojinería, protección partes negras, aditivo quita grasas limpia parabrisas, ambientador interior";

function normalizeItemText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isDetailingHiddenPart(part) {
  if (DETAILING_HIDE_CODES.has(String(part?.supply?.oemCode || "").trim().toUpperCase())) {
    return true;
  }

  const haystack = [
    part?.typeLabel,
    part?.supply?.name,
    part?.supply?.specification,
    part?.supply?.oemCode,
  ].map(normalizeItemText).join(" ");

  return DETAILING_HIDE_PATTERNS.some((pattern) => pattern.test(haystack));
}

function resolveItemKind(name = "", type = "") {
  const text = normalizeItemText(`${type} ${name}`);
  if (text.includes("detailing")) return "detailing";
  if (text.includes("aceite") || text.includes("oil")) return "oil";
  if (text.includes("filtro")) return "filter";
  if (text.includes("empaque") || text.includes("sello")) return "gasket";
  if (text.includes("mano de obra") || text.includes("alistamiento") || text.includes("mantenimiento")) return "labor";
  return "service";
}

function buildClientServiceItems(quote) {
  const items = (quote?.parts || [])
    .filter((part) => !isDetailingHiddenPart(part))
    .map((part) => {
      const isServiceItem = part.type === "other";
      const name = isServiceItem
        ? (part.typeLabel || part.supply?.specification || part.supply?.name || "Ítem de servicio")
        : (part.typeLabel || part.type || "Insumo");
      const detail = isServiceItem
        ? ""
        : [part.supply?.specification || part.supply?.oemCode || "", part.quantityLabel || part.quantityValue || ""]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(" · ");

      return {
        name: String(name || "Ítem").trim(),
        detail: String(detail || "").trim(),
        kind: resolveItemKind(name, part.type),
      };
    });

  items.push({
    name: "Detailing Premium",
    detail: DETAILING_DETAIL,
    kind: "detailing",
  });

  if (Number(quote?.pricing?.laborMecanico || 0) > 0) {
    items.push({
      name: "Mano de obra mantenimiento",
      detail: "Servicio mecánico preventivo",
      kind: "labor",
    });
  }

  if (Number(quote?.pricing?.laborAlistamiento || 0) > 0) {
    items.push({
      name: "Mano de obra alistamiento",
      detail: "Alistamiento y presentación",
      kind: "labor",
    });
  }

  return items;
}

function parseQuoteDate(value) {
  const parsed = value ? new Date(`${value}T12:00:00`) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function formatQuoteDateShort(value) {
  const parsed = parseQuoteDate(value);
  const months = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = months[parsed.getMonth()];
  const year = parsed.getFullYear();
  return `${day} ${month} ${year}`;
}

function formatQuoteDate(value) {
  const parsed = parseQuoteDate(value);
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function addDays(dateValue, days) {
  const next = parseQuoteDate(dateValue);
  next.setDate(next.getDate() + days);
  return next;
}

function buildQuoteNumber(quoteDate, vehicleId, clientDocument) {
  const seed = `${quoteDate || ""}|${vehicleId || ""}|${clientDocument || ""}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  const number = (Math.abs(hash) % 900000) + 100000;
  return `#GI-${String(number).padStart(6, "0")}`;
}

function buildVehicleLabel(quote, year) {
  const vehicle = quote?.vehicle || {};
  const yearLabel = year || (vehicle.yearFrom === vehicle.yearTo
    ? vehicle.yearFrom
    : [vehicle.yearFrom, vehicle.yearTo].filter(Boolean).join(" - "));

  return {
    brand: vehicle.brand || "",
    model: vehicle.model || "",
    version: vehicle.variantLabel || "",
    engine: vehicle.engineCode || "",
    year: yearLabel || "",
    full: [
      vehicle.brand,
      vehicle.model,
      vehicle.variantLabel,
      vehicle.engineCode ? `(${vehicle.engineCode})` : "",
      yearLabel ? `· ${yearLabel}` : "",
    ].filter(Boolean).join(" "),
  };
}

function iconSvg(kind) {
  const common = 'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c4a35a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  switch (kind) {
    case "oil":
      return `<svg ${common}><path d="M8 3h8"/><path d="M10 3v3"/><path d="M14 3v3"/><path d="M7 8h10l-1 11a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 8z"/></svg>`;
    case "filter":
      return `<svg ${common}><rect x="7" y="3" width="10" height="6" rx="1"/><path d="M9 9v9a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V9"/><path d="M9 13h6"/></svg>`;
    case "gasket":
      return `<svg ${common}><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/></svg>`;
    case "detailing":
      return `<svg ${common}><path d="M4 14h16"/><path d="M7 14V9a5 5 0 0 1 10 0v5"/><path d="M8 18h8"/></svg>`;
    case "labor":
      return `<svg ${common}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.9-2.9 2-2.1z"/></svg>`;
    default:
      return `<svg ${common}><path d="M12 3l2.2 4.5L19 8.2l-3.5 3.4.8 4.9L12 14.8 7.7 16.5l.8-4.9L5 8.2l4.8-.7L12 3z"/></svg>`;
  }
}

function metaIcon(kind) {
  const common = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c4a35a" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === "doc") return `<svg ${common}><path d="M8 3h6l4 4v14H8z"/><path d="M14 3v5h5"/><path d="M10 13h6"/><path d="M10 17h6"/></svg>`;
  if (kind === "calendar") return `<svg ${common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/></svg>`;
  if (kind === "clock") return `<svg ${common}><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>`;
  if (kind === "user") return `<svg ${common}><circle cx="12" cy="8" r="3.5"/><path d="M5 19a7 7 0 0 1 14 0"/></svg>`;
  if (kind === "car") return `<svg ${common}><path d="M4 14l2-5h12l2 5"/><path d="M3 14h18v4H3z"/><circle cx="7.5" cy="18" r="1.4"/><circle cx="16.5" cy="18" r="1.4"/></svg>`;
  if (kind === "mail") return `<svg ${common}><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 8l9 6 9-6"/></svg>`;
  if (kind === "phone") return `<svg ${common}><path d="M7 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L16 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 5 7a2 2 0 0 1 2-2z"/></svg>`;
  if (kind === "pin") return `<svg ${common}><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>`;
  return "";
}

function warrantyIcon(kind) {
  const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#c4a35a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === "shield") {
    return `<svg ${common}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.2 12.2l1.8 1.8 3.8-3.8"/></svg>`;
  }
  if (kind === "tech") {
    return `<svg ${common}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19a6.5 6.5 0 0 1 13 0"/><circle cx="18.2" cy="7.2" r="2"/><path d="M18.2 5.4v-.8M18.2 9.8v-.8M16.4 7.2h-.8M20.8 7.2h-.8"/></svg>`;
  }
  if (kind === "badge") {
    return `<svg ${common}><path d="M12 3l2.1 2.1L16.8 4l.7 2.7L20 8l-1.4 2.4L20 12.8l-2.5 1.3-.7 2.7-2.7-1.1L12 18l-2.1-2.3-2.7 1.1-.7-2.7L4 12.8l1.4-2.4L4 8l2.5-1.3L7.2 4l2.7 1.1L12 3z"/><path d="M9.4 12.1l1.7 1.7 3.5-3.5"/></svg>`;
  }
  if (kind === "drop") {
    return `<svg ${common}><path d="M12 3c3.5 4.2 6 7.2 6 10.2A6 6 0 0 1 6 13.2C6 10.2 8.5 7.2 12 3z"/><path d="M10 14.2c.6 1.2 1.7 1.8 2.8 1.8"/></svg>`;
  }
  if (kind === "history") {
    return `<svg ${common}><path d="M8 4h7l3 3v13H8z"/><path d="M15 4v4h4"/><path d="M11 12h5"/><path d="M11 15h5"/><path d="M11 18h3"/><circle cx="9.2" cy="12" r="0.7" fill="#c4a35a" stroke="none"/><circle cx="9.2" cy="15" r="0.7" fill="#c4a35a" stroke="none"/><circle cx="9.2" cy="18" r="0.7" fill="#c4a35a" stroke="none"/></svg>`;
  }
  return "";
}

function buildQuoteDocumentHtml({
  quote,
  clientName,
  clientDocument,
  clientEmail,
  clientPhone,
  quoteDate,
  year,
  logoUrl,
  forEmail = false,
}) {
  const totals = buildQuoteTotals(quote?.pricing?.salePrice ?? quote?.pricing?.costTotal);
  const items = buildClientServiceItems(quote);
  const vehicle = buildVehicleLabel(quote, year);
  const safeLogo = String(logoUrl || COMPANY.logoPath).trim() || COMPANY.logoPath;
  let nexaFontUrl = "/Nexa-Heavy%20(1).ttf";
  try {
    if (/^https?:\/\//i.test(safeLogo)) {
      nexaFontUrl = new URL("/Nexa-Heavy%20(1).ttf", safeLogo).href;
    }
  } catch (_error) {
    nexaFontUrl = "/Nexa-Heavy%20(1).ttf";
  }
  const quoteNumber = buildQuoteNumber(quoteDate, quote?.vehicle?.id, clientDocument);
  const dateShort = formatQuoteDateShort(quoteDate);
  const validUntilShort = formatQuoteDateShort(addDays(quoteDate, 7).toISOString().slice(0, 10));
  const vehicleTitle = `${vehicle.brand} ${vehicle.model}`.trim() || "Vehículo";
  const vehicleSubtitle = [vehicle.version, vehicle.engine ? `(${vehicle.engine})` : "", vehicle.year ? `(${vehicle.year})` : ""]
    .filter(Boolean)
    .join(" ");

  const itemRows = items.map((item, index) => `
    <div class="giq-item">
      <div class="giq-item-num">${index + 1}</div>
      <div class="giq-item-icon">${iconSvg(item.kind)}</div>
      <div class="giq-item-copy">
        <strong>${escapeHtml(item.name)}</strong>
        ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}
      </div>
      <div class="giq-item-badge">
        <span class="giq-check">✓</span>
        <em>INCLUIDO</em>
      </div>
    </div>
  `).join("");

  const includes = [
    "Repuestos originales / OEM",
    "Aceite sintético premium",
    "Mano de obra especializada",
    "Detailing Premium incluido",
    "Revisión de 25 puntos",
    "Historial digital del servicio",
  ].map((line) => `
    <div class="giq-include-row">
      <span class="giq-include-dot"></span>
      <span>${escapeHtml(line)}</span>
    </div>
  `).join("");

  return `
  <div class="cotizador-quote-doc giq-root" data-email="${forEmail ? "1" : "0"}">
    <style>
      @font-face {
        font-family: "Nexa Admin Heavy";
        src: url("${nexaFontUrl}") format("truetype");
        font-weight: 900;
        font-style: normal;
        font-display: swap;
      }
      .giq-root {
        --giq-ink: #121212;
        --giq-gold: #c4a35a;
        --giq-muted: #7a7a7a;
        --giq-line: #e8e8e8;
        --giq-soft: #f7f7f7;
        box-sizing: border-box;
        width: 100%;
        max-width: 920px;
        margin: 0 auto;
        background: #ffffff;
        color: var(--giq-ink);
        font-family: "Montserrat", "Avenir Next", "Segoe UI", Arial, sans-serif;
        border: 1px solid #ececec;
        overflow: hidden;
      }
      .giq-root *, .giq-root *::before, .giq-root *::after { box-sizing: border-box; }
      .giq-shell { position: relative; background: #fff; }
      .giq-mark {
        position: absolute;
        top: 18px;
        right: 24px;
        width: 220px;
        opacity: 0.05;
        pointer-events: none;
        user-select: none;
      }
      .giq-top {
        display: grid;
        grid-template-columns: 118px 1fr;
        gap: 18px;
        padding: 0 28px 8px 0;
        min-height: 168px;
      }
      .giq-ribbon {
        background: #111;
        color: #fff;
        padding: 22px 12px 18px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
      }
      .giq-ribbon img {
        width: 58px;
        height: auto;
        display: block;
      }
      .giq-ribbon-brand {
        display: block;
        margin-top: 8px;
        font-family: "Nexa Admin Heavy", "Syne", Arial, sans-serif !important;
        font-size: 15px;
        letter-spacing: 0.04em;
        line-height: 0.95;
        font-weight: 900;
        color: #ffffff !important;
        text-transform: uppercase;
      }
      .giq-ribbon-sub {
        display: block;
        margin-top: 6px;
        color: #ffffff !important;
        font-size: 8px;
        letter-spacing: 0.16em;
        font-weight: 600;
        text-transform: uppercase;
      }
      .giq-head {
        padding: 28px 8px 10px 8px;
      }
      .giq-head h1 {
        margin: 0;
        font-size: 34px;
        letter-spacing: 0.08em;
        font-weight: 800;
        line-height: 1;
      }
      .giq-head h2 {
        margin: 8px 0 0;
        font-size: 12px;
        letter-spacing: 0.22em;
        font-weight: 500;
        color: #8b8b8b;
      }
      .giq-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 22px;
      }
      .giq-meta-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }
      .giq-meta-item b {
        display: block;
        font-size: 10px;
        letter-spacing: 0.12em;
        color: #9a9a9a;
        font-weight: 700;
      }
      .giq-meta-item span {
        display: block;
        margin-top: 3px;
        font-size: 13px;
        font-weight: 700;
      }
      .giq-body { padding: 8px 28px 24px; }
      .giq-cards {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        border: 1px solid var(--giq-line);
        border-radius: 16px;
        padding: 16px;
        background: #fff;
      }
      .giq-card {
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 12px;
        align-items: start;
      }
      .giq-card + .giq-card {
        border-left: 1px solid var(--giq-line);
        padding-left: 14px;
      }
      .giq-avatar {
        width: 42px;
        height: 42px;
        border-radius: 999px;
        background: #111;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .giq-avatar svg { stroke: #c4a35a; }
      .giq-card h3 {
        margin: 0 0 8px;
        font-size: 18px;
        font-weight: 800;
      }
      .giq-card-line {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 5px;
        font-size: 12px;
        color: #666;
      }
      .giq-card-line svg { flex: 0 0 auto; }
      .giq-vehicle-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        margin-top: 10px;
        font-size: 11px;
        color: #6b6b6b;
        font-weight: 400;
      }
      .giq-vehicle-tags .giq-tag-label {
        display: inline;
        color: #9a9a9a !important;
        font-size: 10px !important;
        font-weight: 500 !important;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .giq-vehicle-tags .giq-tag-value {
        display: inline;
        color: #555 !important;
        font-size: 11px !important;
        font-weight: 400 !important;
        letter-spacing: normal !important;
        text-transform: none !important;
      }
      .giq-main {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.85fr);
        gap: 22px;
        margin-top: 22px;
      }
      .giq-section-title {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 14px;
        font-size: 12px;
        letter-spacing: 0.16em;
        font-weight: 700;
        color: #222;
      }
      .giq-section-title::before {
        content: "";
        width: 18px;
        height: 2px;
        background: var(--giq-gold);
        display: inline-block;
      }
      .giq-item {
        display: grid;
        grid-template-columns: 28px 28px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        padding: 11px 0;
        border-bottom: 1px solid #f0f0f0;
      }
      .giq-item-num {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: #111;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
      }
      .giq-item-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .giq-item-copy strong {
        display: block;
        font-size: 13px;
        font-weight: 750;
      }
      .giq-item-copy span {
        display: block;
        margin-top: 3px;
        font-size: 11px;
        line-height: 1.45;
        color: #7d7d7d;
      }
      .giq-item-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #8a8a8a;
        font-size: 10px;
        letter-spacing: 0.08em;
        font-style: normal;
        white-space: nowrap;
      }
      .giq-item-badge em { font-style: normal; font-weight: 700; }
      .giq-check {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 1.5px solid var(--giq-gold);
        color: var(--giq-gold);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 700;
      }
      .giq-note {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-top: 12px;
        font-size: 11px;
        line-height: 1.5;
        color: #8a8a8a;
      }
      .giq-note i {
        width: 16px;
        height: 16px;
        border-radius: 999px;
        border: 1px solid #cfcfcf;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-style: normal;
        font-size: 10px;
        flex: 0 0 auto;
      }
      .giq-side { display: grid; gap: 14px; align-content: start; }
      .giq-total {
        position: relative;
        overflow: hidden;
        background: #111;
        color: #fff;
        border-radius: 16px;
        padding: 20px 18px 16px;
      }
      .giq-total img {
        position: absolute;
        right: -8px;
        bottom: -10px;
        width: 92px;
        opacity: 0.12;
        pointer-events: none;
      }
      .giq-total-label {
        display: block;
        position: relative;
        z-index: 1;
        font-size: 11px;
        letter-spacing: 0.16em;
        color: #ffffff !important;
        font-weight: 700;
      }
      .giq-total-amount {
        display: block;
        position: relative;
        z-index: 1;
        margin-top: 8px;
        font-size: 32px;
        letter-spacing: -0.03em;
        font-weight: 800;
        line-height: 1;
        color: #ffffff !important;
      }
      .giq-total-note {
        display: block;
        position: relative;
        z-index: 1;
        margin-top: 8px;
        font-size: 11px;
        letter-spacing: 0.12em;
        color: #ffffff !important;
        font-weight: 700;
      }
      .giq-includes h4 {
        margin: 0 0 10px;
        font-size: 11px;
        letter-spacing: 0.12em;
        color: var(--giq-gold);
        font-weight: 800;
      }
      .giq-include-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 0;
        font-size: 12px;
        color: #444;
      }
      .giq-include-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: var(--giq-gold);
        flex: 0 0 auto;
      }
      .giq-breakdown {
        position: relative;
        z-index: 1;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid rgba(255,255,255,0.18);
      }
      .giq-breakdown-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 0;
        font-size: 12px;
        color: rgba(255,255,255,0.82) !important;
      }
      .giq-breakdown-row span,
      .giq-breakdown-row .giq-breakdown-value {
        color: #ffffff !important;
        font-weight: 500;
      }
      .giq-breakdown-row.is-total {
        margin-top: 4px;
        padding-top: 8px;
        border-top: 1px solid rgba(255,255,255,0.22);
        font-size: 14px;
        font-weight: 800;
      }
      .giq-breakdown-row.is-total span,
      .giq-breakdown-row.is-total .giq-breakdown-value {
        color: #ffffff !important;
        font-weight: 800;
      }
      .giq-bottom {
        margin-top: 18px;
      }
      .giq-warranty {
        margin: 0;
        background: #111;
        color: #fff;
        border-radius: 0;
        padding: 22px 28px 18px;
      }
      .giq-warranty-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 14px;
        margin: 0 16px 18px;
      }
      .giq-warranty-title::before,
      .giq-warranty-title::after {
        content: "";
        flex: 1 1 auto;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(196,163,90,0.85), transparent);
        max-width: 140px;
      }
      .giq-warranty-title h4 {
        margin: 0;
        text-align: center;
        font-size: 12px;
        letter-spacing: 0.18em;
        color: #fff;
        font-weight: 800;
        white-space: nowrap;
      }
      .giq-warranty-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0;
        align-items: start;
      }
      .giq-warranty-item {
        text-align: center;
        padding: 4px 12px;
        font-size: 10px;
        line-height: 1.45;
        color: rgba(255,255,255,0.86);
      }
      .giq-warranty-item + .giq-warranty-item {
        border-left: 1px solid rgba(255,255,255,0.18);
      }
      .giq-warranty-item b {
        display: block;
        margin: 10px 0 6px;
        color: var(--giq-gold);
        font-size: 10px;
        letter-spacing: 0.08em;
        font-weight: 800;
        text-transform: uppercase;
      }
      .giq-warranty-ico {
        width: 36px;
        height: 36px;
        margin: 0 auto;
        border-radius: 999px;
        border: 1.5px solid rgba(196,163,90,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(196,163,90,0.06);
      }
      .giq-warranty-ico svg {
        width: 18px;
        height: 18px;
        display: block;
      }
      .giq-footer {
        margin-top: 0;
        background: #111;
        color: rgba(255,255,255,0.82);
        padding: 14px 28px 20px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .giq-footer-lines {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 22px;
        align-items: center;
      }
      .giq-footer-line {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 0;
        font-size: 11px;
        line-height: 1.45;
      }
      .giq-footer-line:last-child { margin-bottom: 0; }
      @media (max-width: 820px) {
        .giq-top, .giq-cards, .giq-main, .giq-footer, .giq-warranty-grid { grid-template-columns: 1fr; }
        .giq-card + .giq-card { border-left: 0; padding-left: 0; border-top: 1px solid var(--giq-line); padding-top: 14px; }
        .giq-warranty-item + .giq-warranty-item { border-left: 0; border-top: 1px solid rgba(255,255,255,0.14); padding-top: 12px; margin-top: 8px; }
        .giq-warranty-title { gap: 10px; }
        .giq-warranty-title::before,
        .giq-warranty-title::after { max-width: 48px; }
        .giq-top { padding: 0; }
        .giq-ribbon { flex-direction: row; justify-content: flex-start; gap: 14px; padding: 16px 18px; }
        .giq-head { padding: 18px; }
        .giq-body { margin-left: 0; margin-right: 0; padding-left: 18px; padding-right: 18px; }
        .giq-warranty, .giq-footer { padding-left: 18px; padding-right: 18px; }
        .giq-footer-lines { flex-direction: column; align-items: flex-start; gap: 8px; }
        .giq-meta { grid-template-columns: 1fr; }
      }
      @media print {
        .giq-root { border: 0; max-width: none; }
        /* Keep desktop layout on Letter/A4 so PDF matches the preview (1 page). */
        .giq-top { grid-template-columns: 100px 1fr !important; padding: 0 18px 4px 0 !important; min-height: 0 !important; }
        .giq-ribbon { flex-direction: column !important; justify-content: flex-start !important; gap: 8px !important; padding: 16px 10px 14px !important; }
        .giq-head { padding: 18px 4px 6px !important; }
        .giq-head h1 { font-size: 28px !important; }
        .giq-meta { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; margin-top: 14px !important; }
        .giq-cards { grid-template-columns: 1fr 1fr !important; }
        .giq-card + .giq-card { border-left: 1px solid var(--giq-line) !important; padding-left: 14px !important; border-top: 0 !important; padding-top: 0 !important; }
        .giq-main { grid-template-columns: minmax(0, 1.35fr) minmax(220px, 0.85fr) !important; gap: 16px !important; margin-top: 14px !important; }
        .giq-warranty-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; }
        .giq-warranty-item + .giq-warranty-item { border-left: 1px solid rgba(255,255,255,0.18) !important; border-top: 0 !important; padding-top: 4px !important; margin-top: 0 !important; }
        .giq-body { padding: 4px 18px 14px !important; }
        .giq-item { padding: 8px 0 !important; }
        .giq-bottom { margin-top: 14px !important; }
        .giq-warranty { padding: 18px 18px 14px !important; border-radius: 0 !important; }
        .giq-footer { margin-top: 0 !important; padding: 12px 18px 16px !important; }
      }
    </style>

    <div class="giq-shell">
      <img class="giq-mark" src="${escapeHtml(safeLogo)}" alt="" />

      <div class="giq-top">
        <aside class="giq-ribbon">
          <img src="${escapeHtml(safeLogo)}" alt="Global Imports" />
          <div>
            <div class="giq-ribbon-brand">GLOBAL<br/>IMPORTS</div>
            <div class="giq-ribbon-sub">PREMIUM SERVICES</div>
          </div>
        </aside>
        <div class="giq-head">
          <h1>COTIZACIÓN</h1>
          <h2>DE MANTENIMIENTO PREVENTIVO</h2>
          <div class="giq-meta">
            <div class="giq-meta-item">
              ${metaIcon("doc")}
              <div><b>NÚMERO</b><span>${escapeHtml(quoteNumber)}</span></div>
            </div>
            <div class="giq-meta-item">
              ${metaIcon("calendar")}
              <div><b>FECHA</b><span>${escapeHtml(dateShort)}</span></div>
            </div>
            <div class="giq-meta-item">
              ${metaIcon("clock")}
              <div><b>VÁLIDA HASTA</b><span>${escapeHtml(validUntilShort)}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="giq-body">
        <div class="giq-cards">
          <div class="giq-card">
            <div class="giq-avatar">${metaIcon("user")}</div>
            <div>
              <div style="font-size:10px;letter-spacing:.14em;color:#9a9a9a;font-weight:700;margin-bottom:4px;">CLIENTE</div>
              <h3>${escapeHtml(clientName || "—")}</h3>
              <div class="giq-card-line">${metaIcon("doc")}<span>CC / NIT: ${escapeHtml(clientDocument || "—")}</span></div>
              <div class="giq-card-line">${metaIcon("mail")}<span>${escapeHtml(clientEmail || "—")}</span></div>
              <div class="giq-card-line">${metaIcon("phone")}<span>${escapeHtml(clientPhone || "—")}</span></div>
            </div>
          </div>
          <div class="giq-card">
            <div class="giq-avatar">${metaIcon("car")}</div>
            <div>
              <div style="font-size:10px;letter-spacing:.14em;color:#9a9a9a;font-weight:700;margin-bottom:4px;">VEHÍCULO</div>
              <h3>${escapeHtml(vehicleTitle)}</h3>
              <div style="font-size:12px;color:#666;line-height:1.45;">${escapeHtml(vehicleSubtitle || "Versión no especificada")}</div>
              <div class="giq-vehicle-tags">
                <span><span class="giq-tag-label">Motor</span> <span class="giq-tag-value">${escapeHtml(vehicle.engine || "—")}</span></span>
                <span><span class="giq-tag-label">Año</span> <span class="giq-tag-value">${escapeHtml(vehicle.year || "—")}</span></span>
                <span><span class="giq-tag-label">Tipo</span> <span class="giq-tag-value">Preventivo Completo</span></span>
              </div>
            </div>
          </div>
        </div>

        <div class="giq-main">
          <section>
            <h3 class="giq-section-title">DETALLE DEL SERVICIO</h3>
            ${itemRows || `<div class="giq-note"><i>i</i><span>Sin ítems en esta cotización.</span></div>`}
            <div class="giq-note">
              <i>i</i>
              <span>Los valores unitarios no se detallan en esta cotización. El total incluye el paquete de servicio preventivo completo.</span>
            </div>
          </section>

          <aside class="giq-side">
            <div class="giq-includes">
              <h4>LO QUE INCLUYE TU SERVICIO</h4>
              ${includes}
            </div>
            <div class="giq-total">
              <img src="${escapeHtml(safeLogo)}" alt="" />
              <div class="giq-total-label">TOTAL A PAGAR</div>
              <div class="giq-total-amount">${money(totals.total)}</div>
              <div class="giq-total-note">IVA INCLUIDO</div>
              <div class="giq-breakdown">
                <div class="giq-breakdown-row">
                  <span>Subtotal</span>
                  <span class="giq-breakdown-value">${money(totals.subtotal)}</span>
                </div>
                <div class="giq-breakdown-row">
                  <span>IVA (19%)</span>
                  <span class="giq-breakdown-value">${money(totals.iva)}</span>
                </div>
                <div class="giq-breakdown-row is-total">
                  <span>TOTAL</span>
                  <span class="giq-breakdown-value">${money(totals.total)}</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div class="giq-bottom">
        <section class="giq-warranty">
          <div class="giq-warranty-title"><h4>GARANTÍA GLOBAL IMPORTS</h4></div>
          <div class="giq-warranty-grid">
            <div class="giq-warranty-item">
              <div class="giq-warranty-ico">${warrantyIcon("shield")}</div>
              <b>Garantía en repuestos</b>
              Todos nuestros repuestos son originales y cuentan con garantía.
            </div>
            <div class="giq-warranty-item">
              <div class="giq-warranty-ico">${warrantyIcon("tech")}</div>
              <b>Técnicos certificados</b>
              Personal altamente capacitado en vehículos de alta gama.
            </div>
            <div class="giq-warranty-item">
              <div class="giq-warranty-ico">${warrantyIcon("badge")}</div>
              <b>Mano de obra</b>
              Garantía en todos nuestros servicios realizados.
            </div>
            <div class="giq-warranty-item">
              <div class="giq-warranty-ico">${warrantyIcon("drop")}</div>
              <b>Insumos premium</b>
              Utilizamos aceites e insumos de la más alta calidad y especificación OEM.
            </div>
            <div class="giq-warranty-item">
              <div class="giq-warranty-ico">${warrantyIcon("history")}</div>
              <b>Historial digital</b>
              Tu mantenimiento queda registrado en nuestro sistema.
            </div>
          </div>
        </section>

        <footer class="giq-footer">
          <div class="giq-footer-lines">
            <div class="giq-footer-line">${metaIcon("pin")}<span>${escapeHtml(COMPANY.address)}</span></div>
            <div class="giq-footer-line">${metaIcon("phone")}<span>${escapeHtml(COMPANY.phoneDisplay)}</span></div>
            <div class="giq-footer-line">${metaIcon("mail")}<span>${escapeHtml(COMPANY.email)}</span></div>
          </div>
        </footer>
      </div>
    </div>
  </div>
  `;
}

function formatClientGreetingName(name) {
  const full = String(name || "").trim() || "Cliente";
  if (/\b(s\.?a\.?s\.?|ltda|s\.?a\.?|inc|llc|corp)\b/i.test(full)) {
    return full;
  }
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length >= 4) {
    return full;
  }
  const first = parts[0] || "Cliente";
  if (first === first.toUpperCase() && first.length > 2) {
    return first.charAt(0) + first.slice(1).toLowerCase();
  }
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function buildQuoteEmailHtml(payload) {
  const logo = String(payload.logoUrl || `https://globalimports.app${COMPANY.logoPath}`).trim();
  const vehicle = buildVehicleLabel(payload.quote, payload.year);
  const vehicleTitle = `${vehicle.brand} ${vehicle.model}`.trim() || "tu vehículo";
  const greetingName = formatClientGreetingName(payload.clientName);
  const quoteNumber = buildQuoteNumber(payload.quoteDate, payload.quote?.vehicle?.id, payload.clientDocument);
  const validUntilShort = formatQuoteDateShort(addDays(payload.quoteDate, 7).toISOString().slice(0, 10));
  const whatsappUrl = COMPANY.whatsapp;

  // Opt out of iOS/Mail dark-mode auto-inversion so the branded dark+gold design stays intact.
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Cotización | Global Imports</title>
    <style>
      :root { color-scheme: light only; supported-color-schemes: light; }
      body, table, td, a { -webkit-text-size-adjust: 100%; }
      u + .body .gi-mail-card { background: #111214 !important; }
    </style>
  </head>
  <body class="body" bgcolor="#060606" style="margin:0;padding:0;background:#060606;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#060606" style="background:#060606;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" class="gi-mail-card" width="620" cellpadding="0" cellspacing="0" border="0" bgcolor="#111214" style="width:100%;max-width:620px;border:1px solid #5c4a28;border-radius:28px;overflow:hidden;background:#111214;">
            <tr>
              <td bgcolor="#111214" style="padding:34px 32px 18px;background:#111214;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td valign="middle" width="64">
                      <img src="${escapeHtml(logo)}" width="52" alt="Global Imports" style="display:block;width:52px;height:auto;border:0;" />
                    </td>
                    <td valign="middle" style="padding-left:12px;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;font-weight:800;">Global Imports</div>
                      <div style="margin-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#c9c3b8;">Premium Services</div>
                    </td>
                  </tr>
                </table>
                <h1 style="margin:22px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.1;letter-spacing:-0.02em;color:#ffffff;font-weight:800;">
                  Tu cotización está lista
                </h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#c9c3b8;">
                  Hola <strong style="color:#ffffff;">${escapeHtml(greetingName)}</strong>, gracias por confiar en Global Imports.
                </p>
              </td>
            </tr>

            <tr>
              <td bgcolor="#111214" style="padding:8px 32px 10px;background:#111214;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#241c10" style="border-radius:20px;background:#241c10;border:1px solid #8a6f35;">
                  <tr>
                    <td bgcolor="#241c10" style="padding:20px 22px;background:#241c10;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#d8aa52;font-weight:700;margin-bottom:8px;">Tu vehículo</div>
                      <div style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.25;">${escapeHtml(vehicleTitle)}</div>
                      <div style="margin-top:8px;font-size:13px;line-height:1.55;color:#e8e0d4;">
                        Preparamos con cuidado la cotización de mantenimiento preventivo para tu ${escapeHtml(vehicleTitle)}.
                      </div>
                      <div style="margin-top:14px;font-size:12px;color:#c9c3b8;line-height:1.6;">
                        Cotización ${escapeHtml(quoteNumber)} · Válida hasta ${escapeHtml(validUntilShort)}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#111214" style="padding:8px 32px 6px;background:#111214;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#d7d0c5;">
                Hacer el mantenimiento con nosotros no es solo cambiar filtros y aceite: es cuidar el rendimiento, la seguridad y el valor de tu vehículo con repuestos de calidad, técnicos especializados e insumos premium.
              </td>
            </tr>
            <tr>
              <td bgcolor="#111214" style="padding:4px 32px 14px;background:#111214;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#d7d0c5;">
                Además, pasas a formar parte de nuestra comunidad: seguimiento de tu historial, acompañamiento cercano y un servicio pensado para quienes exigen lo mejor.
              </td>
            </tr>

            <tr>
              <td bgcolor="#111214" style="padding:6px 32px 18px;background:#111214;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a1a1c" style="border-radius:18px;background:#1a1a1c;border:1px solid #3a3a3c;">
                  <tr>
                    <td width="54" valign="top" bgcolor="#1a1a1c" style="padding:18px 0 18px 18px;background:#1a1a1c;">
                      <div style="width:40px;height:40px;border-radius:12px;background:#3a2f18;border:1px solid #8a6f35;text-align:center;line-height:40px;font-size:13px;color:#d8aa52;font-family:Arial,sans-serif;font-weight:700;">PDF</div>
                    </td>
                    <td valign="middle" bgcolor="#1a1a1c" style="padding:18px 18px 18px 12px;background:#1a1a1c;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:14px;font-weight:800;color:#ffffff;margin-bottom:4px;">Cotización adjunta</div>
                      <div style="font-size:13px;line-height:1.6;color:#c9c3b8;">
                        Encontrarás tu cotización en formato PDF al pie de este correo.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td bgcolor="#111214" style="padding:4px 32px 22px;background:#111214;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#d7d0c5;">
                Si tienes alguna duda o quieres agendar, con gusto te ayudamos.
              </td>
            </tr>

            <tr>
              <td align="left" bgcolor="#111214" style="padding:0 32px 28px;background:#111214;">
                <a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#d8aa52;color:#15110a;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;">
                  Escribir por WhatsApp
                </a>
              </td>
            </tr>

            <tr>
              <td bgcolor="#111214" style="padding:22px 32px 28px;border-top:1px solid #2e2e30;background:#111214;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:6px;">Un abrazo,</div>
                <div style="font-size:14px;color:#ffffff;font-weight:800;margin-bottom:10px;">Equipo Global Imports</div>
                <div style="font-size:12px;line-height:1.8;color:#a9a49a;">
                  Premium Services<br/>
                  ${escapeHtml(COMPANY.phoneDisplay)} · ${escapeHtml(COMPANY.email)}<br/>
                  ${escapeHtml(COMPANY.address)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}


module.exports = {
  COMPANY,
  IVA_RATE,
  buildQuoteTotals,
  buildClientServiceItems,
  buildVehicleLabel,
  buildQuoteDocumentHtml,
  buildQuoteEmailHtml,
  resolvePublicBaseUrl,
  resolveLogoUrl,
  money,
  escapeHtml,
};
