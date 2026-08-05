const fs = require("fs");
const puppeteer = require("puppeteer-core");
const { resolveChromeLaunchOptions } = require("./chromeExecutable");
const {
  COMPANY,
  buildQuoteDocumentHtml,
  buildVehicleLabel,
} = require("./cotizadorQuoteDocument");

const LETTER_WIDTH_PX = 816; // 8.5in @ 96dpi
const LETTER_HEIGHT_PX = 1056; // 11in @ 96dpi

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

function resolveAssetBaseUrl() {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.APP_BASE_URL,
    ...String(process.env.CORS_ORIGIN || "").split(","),
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim().replace(/\/$/, "");
    if (!normalized || normalized === "*" || !/^https?:\/\//i.test(normalized)) {
      continue;
    }
    if (/localhost|127\.0\.0\.1/i.test(normalized)) {
      continue;
    }
    return normalized;
  }

  return "https://globalimports.app";
}

function buildQuotePdfFileName(payload) {
  const quoteNumber = buildQuoteNumber(
    payload.quoteDate,
    payload.quote?.vehicle?.id,
    payload.clientDocument
  ).replace("#", "");
  const vehicle = buildVehicleLabel(payload.quote, payload.year);
  const slug = `${vehicle.brand || "Vehiculo"}-${vehicle.model || "GI"}`
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `Cotizacion-${quoteNumber}-${slug || "Global-Imports"}.pdf`;
}

function absolutizeQuoteAssets(documentHtml, assetBase) {
  const base = String(assetBase || "https://globalimports.app").replace(/\/$/, "");
  return String(documentHtml || "")
    .replaceAll('src="/', `src="${base}/`)
    .replaceAll("src='/", `src='${base}/`)
    .replaceAll('url("/', `url("${base}/`)
    .replaceAll("url('/", `url('${base}/`);
}

function buildPrintableQuoteHtml(documentHtml, assetBase) {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cotización Global Imports</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap" rel="stylesheet" />
    <style>
      @page { margin: 0; size: letter; }
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }
      .cotizador-quote-doc.giq-root {
        box-sizing: border-box;
        width: ${LETTER_WIDTH_PX}px !important;
        max-width: none !important;
        border: 0 !important;
      }
      .giq-shell { padding: 0 !important; }
      .giq-top {
        grid-template-columns: 108px 1fr !important;
        padding: 0 20px 4px 0 !important;
        min-height: 0 !important;
      }
      .giq-ribbon {
        flex-direction: column !important;
        justify-content: flex-start !important;
        gap: 10px !important;
        padding: 20px 12px 16px !important;
      }
      .giq-ribbon img { width: 62px !important; }
      .giq-ribbon-brand { font-size: 15px !important; }
      .giq-ribbon-sub { font-size: 9px !important; }
      .giq-head { padding: 22px 6px 8px !important; }
      .giq-head h1 { font-size: 34px !important; letter-spacing: 0.06em !important; }
      .giq-head h2 { font-size: 12px !important; margin-top: 8px !important; }
      .giq-meta { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; margin-top: 16px !important; gap: 12px !important; }
      .giq-meta-item b { font-size: 10px !important; }
      .giq-meta-item span { font-size: 13px !important; }
      .giq-body { padding: 8px 20px 16px !important; }
      .giq-cards {
        grid-template-columns: 1fr 1fr !important;
        padding: 16px !important;
        gap: 14px !important;
      }
      .giq-card + .giq-card {
        border-left: 1px solid #e8e8e8 !important;
        padding-left: 14px !important;
        border-top: 0 !important;
        padding-top: 0 !important;
      }
      .giq-card h3 { font-size: 19px !important; }
      .giq-card-line { font-size: 12px !important; margin-top: 6px !important; }
      .giq-main {
        grid-template-columns: minmax(0, 1.35fr) minmax(240px, 0.9fr) !important;
        gap: 18px !important;
        margin-top: 18px !important;
      }
      .giq-section-title { font-size: 12px !important; margin-bottom: 14px !important; }
      .giq-item { padding: 10px 0 !important; gap: 11px !important; }
      .giq-item-num { width: 26px !important; height: 26px !important; font-size: 11px !important; }
      .giq-item-copy strong { font-size: 13px !important; }
      .giq-item-copy span { font-size: 11px !important; }
      .giq-item-badge em { font-size: 10px !important; }
      .giq-note { font-size: 11px !important; margin-top: 12px !important; }
      .giq-includes h4 { font-size: 11px !important; }
      .giq-include-row { font-size: 12px !important; padding: 4px 0 !important; }
      .giq-total { padding: 20px 18px !important; }
      .giq-total-label { font-size: 11px !important; }
      .giq-total-amount { font-size: 32px !important; }
      .giq-total-note { font-size: 10px !important; }
      .giq-breakdown-row { font-size: 12px !important; }
      .giq-breakdown-row.is-total { font-size: 14px !important; }
      .giq-warranty-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; }
      .giq-warranty-item + .giq-warranty-item {
        border-left: 1px solid rgba(255,255,255,0.18) !important;
        border-top: 0 !important;
        padding-top: 4px !important;
        margin-top: 0 !important;
      }
      .giq-warranty-title { margin-bottom: 16px !important; }
      .giq-warranty-title h4 { font-size: 12px !important; }
      .giq-warranty-item { font-size: 10px !important; padding: 4px 10px !important; }
      .giq-warranty-item b { font-size: 10px !important; }
      .giq-warranty-ico { width: 38px !important; height: 38px !important; }
      .giq-bottom { margin-top: 16px !important; }
      .giq-warranty {
        margin: 0 !important;
        border-radius: 0 !important;
        padding: 22px 20px 16px !important;
      }
      .giq-footer {
        margin: 0 !important;
        padding: 14px 20px 18px !important;
        border-top: 1px solid rgba(255,255,255,0.14) !important;
      }
      .giq-footer-lines {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 8px 22px !important;
        align-items: center !important;
      }
      .giq-footer-line { font-size: 11px !important; }
    </style>
  </head>
  <body>
    ${absolutizeQuoteAssets(documentHtml, assetBase)}
  </body>
</html>`;
}

async function buildQuotePdfBuffer(payload) {
  const assetBase = resolveAssetBaseUrl();
  const logoUrl = String(
    payload.logoUrlAbsolute
    || payload.logoUrl
    || `${assetBase}${COMPANY.logoPath}`
  ).trim();

  const documentHtml = buildQuoteDocumentHtml({
    quote: payload.quote,
    clientName: payload.clientName,
    clientDocument: payload.clientDocument,
    clientEmail: payload.clientEmail,
    clientPhone: payload.clientPhone,
    quoteDate: payload.quoteDate,
    year: payload.year,
    logoUrl,
    forEmail: false,
  });

  const fullHtml = buildPrintableQuoteHtml(documentHtml, assetBase);
  const launchOptions = await resolveChromeLaunchOptions();
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    // Above 820px breakpoint so desktop columns stay active.
    await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1 });
    await page.setContent(fullHtml, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Pin warranty + company block to the physical bottom of the Letter page.
    const layout = await page.evaluate(({ pageHeight }) => {
      const root = document.querySelector(".cotizador-quote-doc");
      const bottom = document.querySelector(".giq-bottom");
      if (!root || !bottom) {
        return { height: 0, overflow: false, spacer: 0 };
      }

      bottom.style.marginTop = "0px";
      const naturalHeight = Math.ceil(root.getBoundingClientRect().height);
      const spacer = Math.max(0, pageHeight - naturalHeight);
      if (spacer > 0) {
        bottom.style.marginTop = `${spacer}px`;
      }

      const finalHeight = Math.ceil(root.getBoundingClientRect().height);
      return {
        height: finalHeight,
        naturalHeight,
        spacer,
        overflow: naturalHeight > pageHeight + 1,
      };
    }, { pageHeight: LETTER_HEIGHT_PX });

    let scale = 1;
    if (layout.overflow) {
      await page.evaluate(() => {
        const bottom = document.querySelector(".giq-bottom");
        if (bottom) bottom.style.marginTop = "0px";
      });
      scale = Math.max(0.72, Math.min(1, LETTER_HEIGHT_PX / Math.max(layout.naturalHeight, 1)));
    }

    const pdf = await page.pdf({
      width: "8.5in",
      height: "11in",
      printBackground: true,
      preferCSSPageSize: false,
      scale,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0",
      },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = {
  buildQuotePdfBuffer,
  buildQuotePdfFileName,
  buildPrintableQuoteHtml,
};
