const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { resolveChromeLaunchOptions } = require("./chromeExecutable");

const GOLD = "#c4a35a";
const INK = "#111111";
const MUTED = "#6b6b6b";

const COMPANY = {
  name: "Global Imports",
  address: "Barranquilla, Colombia",
  phoneDisplay: "301 669 8126",
  web: "globalimports.app",
  instagram: "@globalimports",
};

const ANSWER_LABELS = {
  leaks: { no: "No", leve: "Leve", si: "Sí" },
  faultCodes: { no: "No", menores: "Sí (menores)", importantes: "Sí (importantes)" },
  engine: { excelente: "Excelente", revision: "Requiere revisión", deficiente: "Deficiente" },
  brakes: { excelente: "Excelente", proximo: "Próximo mantenimiento", inmediato: "Cambio inmediato" },
  suspension: { no: "No", leves: "Leves", si: "Sí" },
  battery: { correcto: "Correcto", bajo: "Bajo rendimiento", reemplazar: "Reemplazar" },
  tires: { bueno: "Buen desgaste", medio: "Desgaste medio", cambio: "Cambio recomendado" },
  cooling: { correcto: "Correcto", mantenimiento: "Requiere mantenimiento", falla: "Fuga o falla" },
  wearComponents: { no: "No", preventivo: "Sí (preventivo)", urgente: "Sí (urgente)" },
  oxidation: { bajo: "Bajo", leves: "Leves", importantes: "Importantes" },
  nextService: { "5000": "En 5.000 km", "10000": "En 10.000 km", before5000: "Revisar antes de 5.000 km" },
  overallState: { excelente: "Excelente", bueno: "Bueno", regular: "Regular", reparacion: "Requiere reparación" },
  bodyDamage: { no: "No", leves: "Leves", si: "Sí" },
};

const ANSWER_TONES = {
  leaks: { no: "ok", leve: "warn", si: "bad" },
  faultCodes: { no: "ok", menores: "warn", importantes: "bad" },
  engine: { excelente: "ok", revision: "warn", deficiente: "bad" },
  brakes: { excelente: "ok", proximo: "warn", inmediato: "bad" },
  suspension: { no: "ok", leves: "warn", si: "bad" },
  battery: { correcto: "ok", bajo: "warn", reemplazar: "bad" },
  tires: { bueno: "ok", medio: "warn", cambio: "bad" },
  cooling: { correcto: "ok", mantenimiento: "warn", falla: "bad" },
  wearComponents: { no: "ok", preventivo: "warn", urgente: "bad" },
  oxidation: { bajo: "ok", leves: "warn", importantes: "bad" },
  nextService: { "5000": "ok", "10000": "ok", before5000: "warn" },
  overallState: { excelente: "ok", bueno: "ok", regular: "warn", reparacion: "bad" },
  bodyDamage: { no: "ok", leves: "warn", si: "bad" },
};

const SCORE_MAP = {
  leaks: { no: 100, leve: 60, si: 20 },
  faultCodes: { no: 100, menores: 55, importantes: 15 },
  engine: { excelente: 100, revision: 55, deficiente: 15 },
  brakes: { excelente: 100, proximo: 55, inmediato: 10 },
  suspension: { no: 100, leves: 60, si: 20 },
  battery: { correcto: 100, bajo: 55, reemplazar: 15 },
  tires: { bueno: 100, medio: 55, cambio: 15 },
  cooling: { correcto: 100, mantenimiento: 55, falla: 15 },
  wearComponents: { no: 100, preventivo: 55, urgente: 15 },
  oxidation: { bajo: 100, leves: 60, importantes: 20 },
  nextService: { "5000": 95, "10000": 100, before5000: 50 },
  overallState: { excelente: 100, bueno: 80, regular: 50, reparacion: 15 },
  bodyDamage: { no: 100, leves: 65, si: 25 },
};

const QUESTION_META = [
  { key: "leaks", section: "Estado general", sectionKey: "general", label: "¿El vehículo presenta fugas de aceite, refrigerante o líquidos?" },
  { key: "faultCodes", section: "Estado general", sectionKey: "general", label: "¿Se detectaron testigos o códigos de falla en el tablero?" },
  { key: "engine", section: "Estado general", sectionKey: "general", label: "¿El motor funciona correctamente? (ralentí, vibraciones, ruidos, humo)" },
  { key: "brakes", section: "Estado general", sectionKey: "general", label: "¿El sistema de frenos se encuentra en buen estado?" },
  { key: "suspension", section: "Estado general", sectionKey: "general", label: "¿La suspensión y dirección presentan holguras o ruidos?" },
  { key: "battery", section: "Inspección preventiva", sectionKey: "preventive", label: "Estado de la batería y sistema de carga" },
  { key: "tires", section: "Inspección preventiva", sectionKey: "preventive", label: "Estado de las llantas" },
  { key: "cooling", section: "Inspección preventiva", sectionKey: "preventive", label: "Estado del sistema de refrigeración" },
  { key: "wearComponents", section: "Inspección preventiva", sectionKey: "preventive", label: "¿Se encontraron componentes con desgaste próximo a reemplazo?" },
  { key: "oxidation", section: "Inspección preventiva", sectionKey: "preventive", label: "¿Grado de oxidación del vehículo en parte inferior y chasis?" },
  { key: "nextService", section: "Recomendaciones", sectionKey: "reco", label: "Próximo mantenimiento recomendado" },
  { key: "overallState", section: "Recomendaciones", sectionKey: "reco", label: "Estado general del vehículo" },
  { key: "bodyDamage", section: "Recomendaciones", sectionKey: "reco", label: "¿Se encontraron rayones o golpes en la carrocería?" },
];

const SECTION_META = {
  general: { title: "Estado general", icon: "shield" },
  preventive: { title: "Inspección preventiva", icon: "search" },
  reco: { title: "Recomendaciones", icon: "list" },
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatAnswer(key, value) {
  const map = ANSWER_LABELS[key] || {};
  return map[value] || String(value || "—");
}

function answerTone(key, value) {
  return ANSWER_TONES[key]?.[value] || "ok";
}

function computeScore(diagnosis = {}) {
  let total = 0;
  let count = 0;
  QUESTION_META.forEach((item) => {
    const score = SCORE_MAP[item.key]?.[diagnosis[item.key]];
    if (score == null) return;
    total += score;
    count += 1;
  });
  if (!count) return 0;
  return Math.round(total / count);
}

function scoreBand(score) {
  if (score >= 80) return { label: "Excelente", tone: "ok", legend: "Óptimo" };
  if (score >= 50) return { label: "Aceptable", tone: "warn", legend: "Aceptable" };
  return { label: "Atención", tone: "bad", legend: "Atención" };
}

function formatKm(value) {
  if (value == null || value === "") return "—";
  return `${Number(value).toLocaleString("es-CO")} km`;
}

function formatServiceDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function fileToDataUri(absolutePath) {
  if (!absolutePath || !fs.existsSync(absolutePath)) return "";
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg"
    ? "image/jpeg"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : "image/png";
  return `data:${mime};base64,${fs.readFileSync(absolutePath).toString("base64")}`;
}

function resolveMediaSrc(urlValue) {
  const url = String(urlValue || "").trim();
  if (!url) return "";
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;

  const relative = url.replace(/^\//, "");
  const candidates = [
    path.join(__dirname, "..", "..", relative),
    path.join(__dirname, "..", "..", "public", relative),
    path.join(__dirname, "..", "..", "host", relative),
  ];
  for (const candidate of candidates) {
    const dataUri = fileToDataUri(candidate);
    if (dataUri) return dataUri;
  }
  return url;
}

function loadBrandLogoDataUri() {
  const candidates = [
    path.join(__dirname, "..", "..", "public", "logoblancoleon.png"),
    path.join(__dirname, "..", "..", "host", "logoblancoleon.png"),
  ];
  for (const candidate of candidates) {
    const dataUri = fileToDataUri(candidate);
    if (dataUri) return dataUri;
  }
  return "";
}

function sectionIconSvg(kind) {
  if (kind === "search") {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="#d8aa52" stroke-width="1.8"/><path d="M16 16l4 4" stroke="#d8aa52" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  if (kind === "list") {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="#d8aa52" stroke-width="1.8"/><path d="M8 9h8M8 12h8M8 15h5" stroke="#d8aa52" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 5-3.2 8.6-7 10-3.8-1.4-7-5-7-10V6l7-3z" stroke="#d8aa52" stroke-width="1.8"/><path d="M9 12l2 2 4-4" stroke="#d8aa52" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function metaIconSvg(kind, stroke = "#111111") {
  const icons = {
    order: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="18" rx="2" stroke="${stroke}" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h4" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    car: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 14l1.5-4.5A3 3 0 0 1 8.4 7h7.2a3 3 0 0 1 2.9 2.5L20 14" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/><path d="M4 14h16v3a1 1 0 0 1-1 1h-1.2a2 2 0 0 1-3.6 0H9.8a2 2 0 0 1-3.6 0H5a1 1 0 0 1-1-1v-3z" stroke="${stroke}" stroke-width="1.7"/><circle cx="8" cy="15.5" r="1" fill="${stroke}"/><circle cx="16" cy="15.5" r="1" fill="${stroke}"/></svg>`,
    plate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="8" rx="2" stroke="${stroke}" stroke-width="1.7"/><path d="M7 12h2M11 12h6" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="${stroke}" stroke-width="1.7"/><path d="M5.5 18.5c1.5-3 4-4.5 6.5-4.5s5 1.5 6.5 4.5" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    gauge: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5.5 16.5a8 8 0 1 1 13 0" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/><path d="M12 14l3.5-3.5" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="14" r="1.2" fill="${stroke}"/></svg>`,
    calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="15" rx="2" stroke="${stroke}" stroke-width="1.7"/><path d="M8 3v4M16 3v4M4 10h16" stroke="${stroke}" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  };
  return icons[kind] || "";
}

function dedupePhotos(photos = []) {
  const seen = new Set();
  return photos.filter((photo) => {
    const key = `${String(photo?.url || "").trim()}|${String(photo?.name || "").trim().toLowerCase()}`;
    if (!key || key === "|" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toneBadge(tone, label) {
  const colors = {
    ok: { bg: "#e8f7ee", fg: "#157a40", ring: "#1f8f4e" },
    warn: { bg: "#f8f1df", fg: "#8a6f35", ring: "#c4a35a" },
    bad: { bg: "#fdecec", fg: "#b42318", ring: "#d92d20" },
  };
  const c = colors[tone] || colors.ok;
  return `
    <span class="badge" style="background:${c.bg};color:${c.fg};border-color:${c.ring};">
      <span class="badge-dot" style="background:${c.ring};">✓</span>
      ${escapeHtml(label)}
    </span>
  `;
}

function buildGaugeHtml(score, band) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const angle = Math.round((clamped / 100) * 360);
  const color = band.tone === "ok" ? "#1f8f4e" : band.tone === "warn" ? "#c4a35a" : "#d92d20";
  return `
    <div class="gauge" style="background:conic-gradient(${color} ${angle}deg, #ececec 0deg);">
      <div class="gauge-inner">
        <strong>${clamped}</strong>
        <span>/ 100</span>
      </div>
    </div>
  `;
}

function buildDiagnosisHtml(order) {
  const vehicle = order.vehicle || {};
  const client = order.client || {};
  const diagnosis = order.diagnosis || {};
  const questionNotes = diagnosis.questionNotes instanceof Map
    ? Object.fromEntries(diagnosis.questionNotes.entries())
    : (diagnosis.questionNotes && typeof diagnosis.questionNotes === "object" ? diagnosis.questionNotes : {});
  const complementary = Array.isArray(diagnosis.complementaryServices)
    ? diagnosis.complementaryServices.filter(Boolean)
    : [];
  const photos = dedupePhotos(Array.isArray(order.photos) ? order.photos : []).slice(0, 5);
  const vehicleTitle = [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Vehículo";
  const logoSrc = loadBrandLogoDataUri();
  const signatureSrc = resolveMediaSrc(order.technicianSignatureUrl);
  const score = computeScore(diagnosis);
  const band = scoreBand(score);
  const overallLabel = ANSWER_LABELS.overallState[diagnosis.overallState] || band.label;

  const sections = ["general", "preventive", "reco"].map((sectionKey) => {
    const meta = SECTION_META[sectionKey];
    const items = QUESTION_META.filter((item) => item.sectionKey === sectionKey);
    const rows = items.map((item) => {
      const globalIndex = QUESTION_META.findIndex((q) => q.key === item.key) + 1;
      const note = String(questionNotes[item.key] || "").trim();
      const tone = answerTone(item.key, diagnosis[item.key]);
      return `
        <div class="q-row">
          <div class="q-num">${String(globalIndex).padStart(2, "0")}</div>
          <div class="q-body">
            <div class="q-label">${escapeHtml(item.label)}</div>
            ${note ? `<div class="q-note"><strong>Nota:</strong> ${escapeHtml(note)}</div>` : ""}
          </div>
          <div class="q-answer">${toneBadge(tone, formatAnswer(item.key, diagnosis[item.key]))}</div>
        </div>
      `;
    }).join("");

    return `
      <section class="section-block">
        <aside class="section-tab">
          <div class="section-icon">${sectionIconSvg(meta.icon)}</div>
          <div class="section-title">${escapeHtml(meta.title)}</div>
        </aside>
        <div class="section-rows">${rows}</div>
      </section>
    `;
  }).join("");

  const photoCells = photos.map((photo) => `
    <div class="photo-cell">
      <img src="${escapeHtml(resolveMediaSrc(photo.url))}" alt="${escapeHtml(photo.name || "Foto")}" />
    </div>
  `).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Diagnóstico ${escapeHtml(order.orderNumber)}</title>
  <style>
    @page { size: letter; margin: 5mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: ${INK};
      background: #fff;
      font-size: 9.5px;
    }
    .page {
      width: 100%;
      min-height: 269mm;
      display: flex;
      flex-direction: column;
    }
    .content { flex: 1 1 auto; }
    .header {
      display: grid;
      grid-template-columns: 108px 1fr;
      gap: 12px;
      align-items: stretch;
      margin-bottom: 8px;
    }
    .brand-mark {
      background: #111;
      border-radius: 0 0 18px 0;
      color: #fff;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      gap: 6px;
      min-height: 96px;
    }
    .brand-mark img { width: 42px; height: auto; display: block; }
    .brand-mark .gi-name {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      line-height: 1.1;
    }
    .brand-mark .gi-sub {
      font-size: 7px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${GOLD};
      font-weight: 700;
    }
    .title-wrap h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: 0.04em;
      line-height: 1;
    }
    .title-wrap .subtitle {
      margin: 4px 0 8px;
      color: ${GOLD};
      font-size: 8.5px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .meta-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0;
      border-top: 1px solid #ececec;
      border-bottom: 1px solid #ececec;
      padding: 7px 0;
    }
    .meta-item {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 7px;
      align-items: center;
      padding: 0 10px;
      border-right: 1px solid #ececec;
    }
    .meta-item:first-child { padding-left: 0; }
    .meta-item:last-child { border-right: 0; padding-right: 0; }
    .meta-item span {
      display: block;
      font-size: 7.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${MUTED};
      font-weight: 700;
    }
    .meta-item strong {
      display: block;
      margin-top: 2px;
      font-size: 11px;
    }
    .service-bar {
      margin: 8px 0 8px;
      background: #151515;
      color: #fff;
      border-radius: 12px;
      padding: 10px 12px;
    }
    .service-bar .bar-title {
      font-size: 7.5px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${GOLD};
      font-weight: 800;
      margin-bottom: 7px;
    }
    .service-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .service-item {
      display: grid;
      grid-template-columns: 18px 1fr;
      gap: 7px;
      align-items: center;
      padding-right: 8px;
      border-right: 1px solid rgba(255,255,255,0.15);
    }
    .service-item:last-child { border-right: 0; padding-right: 0; }
    .service-item span {
      display: block;
      font-size: 7.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.7);
      font-weight: 700;
    }
    .service-item strong {
      display: block;
      margin-top: 2px;
      font-size: 11px;
      font-weight: 800;
    }
    .diag-layout {
      display: grid;
      grid-template-columns: 1.55fr 0.9fr;
      gap: 8px;
      align-items: start;
    }
    .section-block {
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 6px;
      margin-bottom: 5px;
    }
    .section-tab {
      background: #151515;
      color: #fff;
      border-radius: 10px;
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 100%;
      text-align: center;
    }
    .section-title {
      font-size: 7px;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      font-weight: 800;
      line-height: 1.2;
    }
    .section-rows {
      border: 1px solid #ececec;
      border-radius: 10px;
      overflow: hidden;
    }
    .q-row {
      display: grid;
      grid-template-columns: 22px 1fr auto;
      gap: 6px;
      align-items: center;
      padding: 4px 7px;
      border-bottom: 1px solid #f0f0f0;
    }
    .q-row:last-child { border-bottom: 0; }
    .q-num {
      font-size: 8.5px;
      font-weight: 800;
      color: ${GOLD};
    }
    .q-label {
      font-size: 8.5px;
      line-height: 1.25;
      color: #222;
      font-weight: 600;
    }
    .q-note {
      margin-top: 1px;
      font-size: 7.5px;
      line-height: 1.25;
      color: ${MUTED};
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid;
      border-radius: 999px;
      padding: 2px 6px 2px 3px;
      font-size: 8px;
      font-weight: 800;
      white-space: nowrap;
    }
    .badge-dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      color: #fff;
      display: grid;
      place-items: center;
      font-size: 7px;
      line-height: 1;
    }
    .side-card {
      border: 1px solid #ececec;
      border-radius: 10px;
      padding: 8px;
      margin-bottom: 6px;
    }
    .side-card h3 {
      margin: 0 0 6px;
      font-size: 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${GOLD};
    }
    .gauge {
      width: 90px;
      height: 90px;
      border-radius: 999px;
      margin: 0 auto 5px;
      display: grid;
      place-items: center;
    }
    .gauge-inner {
      width: 66px;
      height: 66px;
      border-radius: 999px;
      background: #fff;
      display: grid;
      place-items: center;
      text-align: center;
      box-shadow: inset 0 0 0 1px #f0f0f0;
    }
    .gauge-inner strong {
      font-size: 22px;
      line-height: 1;
      display: block;
    }
    .gauge-inner span {
      font-size: 8px;
      color: ${MUTED};
    }
    .score-label {
      text-align: center;
      font-size: 9px;
      font-weight: 800;
      margin-bottom: 5px;
    }
    .score-label .tone-ok { color: #157a40; }
    .score-label .tone-warn { color: #8a6f35; }
    .score-label .tone-bad { color: #b42318; }
    .legend {
      display: grid;
      gap: 2px;
      font-size: 7px;
      color: ${MUTED};
    }
    .legend i {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 999px;
      margin-right: 4px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      background: #f6f1e5;
      color: #6b5320;
      border: 1px solid #e2d3b0;
      border-radius: 999px;
      padding: 3px 6px;
      font-size: 8px;
      font-weight: 700;
    }
    .obs {
      font-size: 8.5px;
      line-height: 1.35;
      color: #333;
      border-left: 2px solid ${GOLD};
      padding-left: 7px;
      font-style: italic;
      max-height: 58px;
      overflow: hidden;
    }
    .photos { margin-top: 6px; }
    .photos h2 {
      margin: 0 0 4px;
      font-size: 8.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${GOLD};
    }
    .photo-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
    }
    .photo-cell {
      border: 1px solid #ececec;
      border-radius: 6px;
      overflow: hidden;
      height: 56px;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3px;
    }
    .photo-cell img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      object-position: center;
      display: block;
    }
    .closing {
      margin-top: 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .footer {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 10px;
      align-items: end;
      padding-top: 6px;
      border-top: 1px solid #ececec;
    }
    .footer-left span {
      display: block;
      font-size: 7.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${MUTED};
      font-weight: 700;
    }
    .footer-left strong {
      display: block;
      margin-top: 2px;
      font-size: 10px;
    }
    .footer-left .when {
      margin-top: 3px;
      color: ${MUTED};
      font-size: 8.5px;
    }
    .sign-box { text-align: center; }
    .sign-box img {
      max-width: 140px;
      max-height: 34px;
      object-fit: contain;
      display: block;
      margin: 0 auto 2px;
    }
    .sign-box .line {
      border-top: 1px solid #ddd;
      margin: 0 auto 4px;
      width: 85%;
    }
    .sign-box .name { font-size: 10px; font-weight: 800; }
    .sign-box .role {
      margin-top: 1px;
      font-size: 7.5px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: ${MUTED};
      font-weight: 700;
    }
    .contact {
      margin-top: 6px;
      background: #151515;
      color: #ddd;
      border-radius: 10px;
      padding: 8px 10px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      font-size: 7.5px;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .contact strong {
      display: block;
      color: ${GOLD};
      margin-bottom: 1px;
      font-size: 7px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="content">
    <header class="header">
      <div class="brand-mark">
        ${logoSrc ? `<img src="${escapeHtml(logoSrc)}" alt="Global Imports" />` : ""}
        <div class="gi-name">GLOBAL<br/>IMPORTS</div>
        <div class="gi-sub">Premium Services</div>
      </div>
      <div class="title-wrap">
        <h1>DIAGNÓSTICO</h1>
        <div class="subtitle">Reporte técnico de servicio</div>
        <div class="meta-row">
          <div class="meta-item">
            <div>${metaIconSvg("order")}</div>
            <div><span>Orden</span><strong>${escapeHtml(order.orderNumber || "—")}</strong></div>
          </div>
          <div class="meta-item">
            <div>${metaIconSvg("car")}</div>
            <div><span>Vehículo</span><strong>${escapeHtml(vehicleTitle)}</strong></div>
          </div>
          <div class="meta-item">
            <div>${metaIconSvg("plate")}</div>
            <div><span>Placa</span><strong>${escapeHtml(vehicle.plate || "—")}</strong></div>
          </div>
        </div>
      </div>
    </header>

    <section class="service-bar">
      <div class="bar-title">Datos del servicio</div>
      <div class="service-grid">
        <div class="service-item">
          <div>${metaIconSvg("user", "#ffffff")}</div>
          <div><span>Cliente</span><strong>${escapeHtml(client.name || "—")}</strong></div>
        </div>
        <div class="service-item">
          <div>${metaIconSvg("gauge", "#ffffff")}</div>
          <div><span>Km actual</span><strong>${escapeHtml(formatKm(order.currentKm))}</strong></div>
        </div>
        <div class="service-item">
          <div>${metaIconSvg("calendar", "#ffffff")}</div>
          <div><span>Próximo mantenimiento</span><strong>${escapeHtml(formatKm(order.nextServiceKm))}</strong></div>
        </div>
      </div>
    </section>

    <div class="diag-layout">
      <div class="diag-main">
        <div style="margin:0 0 8px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${GOLD};font-weight:800;">Resultado del diagnóstico</div>
        ${sections}
      </div>
      <aside>
        <div class="side-card">
          <h3>Resumen general</h3>
          ${buildGaugeHtml(score, band)}
          <div class="score-label">Estado general <span class="tone-${band.tone}">${escapeHtml(overallLabel)}</span></div>
          <div class="legend">
            <div><i style="background:#1f8f4e;"></i>Óptimo (80-100)</div>
            <div><i style="background:#c4a35a;"></i>Aceptable (50-79)</div>
            <div><i style="background:#d92d20;"></i>Atención (0-49)</div>
          </div>
        </div>
        <div class="side-card">
          <h3>Servicios complementarios</h3>
          <div class="chips">
            ${complementary.length
              ? complementary.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")
              : `<span class="chip">Ninguno</span>`}
          </div>
        </div>
        <div class="side-card">
          <h3>Observaciones del técnico</h3>
          <div class="obs">${escapeHtml(diagnosis.observations || "Sin observaciones adicionales.")}</div>
        </div>
      </aside>
    </div>

    ${photos.length ? `
      <section class="photos">
        <h2>Anexo fotográfico</h2>
        <div class="photo-grid">${photoCells}</div>
      </section>
    ` : ""}
    </div>

    <div class="closing">
      <footer class="footer">
        <div class="footer-left">
          <span>Servicio realizado por</span>
          <strong>Equipo Técnico Global Imports</strong>
          <div class="when">${escapeHtml(formatServiceDate(order.completedAt || order.updatedAt || order.createdAt))}</div>
        </div>
        <div class="sign-box">
          ${signatureSrc ? `<img src="${escapeHtml(signatureSrc)}" alt="Firma" />` : `<div style="height:28px;"></div>`}
          <div class="line"></div>
          <div class="name">${escapeHtml(order.technicianName || "Técnico responsable")}</div>
          <div class="role">Técnico responsable</div>
        </div>
      </footer>
      <div class="contact">
        <div><strong>Ubicación</strong>${escapeHtml(COMPANY.address)}</div>
        <div><strong>Teléfono</strong>${escapeHtml(COMPANY.phoneDisplay)}</div>
        <div><strong>Web</strong>${escapeHtml(COMPANY.web)}</div>
        <div><strong>Instagram</strong>${escapeHtml(COMPANY.instagram)}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function buildMechanicDiagnosisPdfBuffer(order) {
  const launchOptions = await resolveChromeLaunchOptions();
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(buildDiagnosisHtml(order), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function buildMechanicDiagnosisFileName(order) {
  const plate = String(order?.vehicle?.plate || "SIN-PLACA").replace(/[^a-zA-Z0-9-_]+/g, "-");
  return `Diagnostico-${order.orderNumber || "GI"}-${plate}.pdf`;
}

function buildMechanicDiagnosisEmailHtml(order) {
  const vehicle = order.vehicle || {};
  const client = order.client || {};
  const vehicleTitle = [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "tu vehículo";
  const greetingName = String(client.name || "cliente").trim().split(/\s+/)[0] || "cliente";
  const score = computeScore(order.diagnosis || {});
  const band = scoreBand(score);
  const kmLabel = formatKm(order.currentKm);
  const nextKmLabel = formatKm(order.nextServiceKm);

  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light" />
    <title>Diagnóstico | Global Imports</title>
    <style>
      :root { color-scheme: light only; supported-color-schemes: light; }
      body, table, td, a { -webkit-text-size-adjust: 100%; }
    </style>
  </head>
  <body bgcolor="#060606" style="margin:0;padding:0;background:#060606;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#060606" style="background:#060606;">
      <tr>
        <td align="center" style="padding:28px 14px;">
          <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" bgcolor="#111214" style="width:100%;max-width:620px;border:1px solid #5c4a28;border-radius:28px;overflow:hidden;background:#111214;">
            <tr>
              <td style="padding:34px 32px 18px;font-family:Arial,Helvetica,sans-serif;">
                <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;font-weight:800;">Global Imports</div>
                <div style="margin-top:4px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#c9c3b8;">Premium Services · Diagnóstico</div>
                <h1 style="margin:22px 0 10px;font-size:30px;line-height:1.1;color:#ffffff;font-weight:800;">Tu diagnóstico está listo</h1>
                <p style="margin:0;font-size:15px;line-height:1.7;color:#c9c3b8;">
                  Hola <strong style="color:#ffffff;">${escapeHtml(greetingName)}</strong>, adjuntamos el reporte técnico de servicio de tu vehículo con el mismo diseño premium del taller.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 10px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#241c10" style="border-radius:20px;background:#241c10;border:1px solid #8a6f35;">
                  <tr>
                    <td style="padding:20px 22px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#d8aa52;font-weight:700;margin-bottom:8px;">Vehículo</div>
                      <div style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.25;">${escapeHtml(vehicleTitle)}</div>
                      <div style="margin-top:8px;font-size:13px;line-height:1.55;color:#e8e0d4;">
                        Placa ${escapeHtml(vehicle.plate || "—")} · Orden ${escapeHtml(order.orderNumber || "—")}
                      </div>
                      <div style="margin-top:10px;font-size:12px;color:#c9c3b8;line-height:1.6;">
                        Km actual: ${escapeHtml(kmLabel)} · Próximo mantenimiento: ${escapeHtml(nextKmLabel)} · Score ${score}/100 (${escapeHtml(band.label)})
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:#d7d0c5;">
                El PDF adjunto incluye el resultado del diagnóstico, observaciones, servicios complementarios${order.technicianName ? ` y la firma de ${escapeHtml(order.technicianName)}` : ""}.
              </td>
            </tr>
            <tr>
              <td style="padding:6px 32px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#1a1a1c" style="border-radius:18px;background:#1a1a1c;border:1px solid #3a3a3c;">
                  <tr>
                    <td width="54" valign="top" style="padding:18px 0 18px 18px;">
                      <div style="width:40px;height:40px;border-radius:12px;background:#3a2f18;border:1px solid #8a6f35;text-align:center;line-height:40px;font-size:13px;color:#d8aa52;font-family:Arial,sans-serif;font-weight:700;">PDF</div>
                    </td>
                    <td valign="middle" style="padding:18px 18px 18px 12px;font-family:Arial,Helvetica,sans-serif;">
                      <div style="font-size:14px;font-weight:800;color:#ffffff;margin-bottom:4px;">Reporte técnico adjunto</div>
                      <div style="font-size:13px;line-height:1.6;color:#c9c3b8;">Abre el PDF para ver el diagnóstico completo e imprimirlo si lo necesitas.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 30px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#8a847a;">
                Global Imports · ${escapeHtml(COMPANY.address)} · ${escapeHtml(COMPANY.phoneDisplay)}
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
  buildMechanicDiagnosisPdfBuffer,
  buildMechanicDiagnosisFileName,
  buildMechanicDiagnosisEmailHtml,
  ANSWER_LABELS,
  QUESTION_META,
};
