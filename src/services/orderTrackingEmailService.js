const { sendBrevoEmail } = require("./brevoEmailService");
const { wrapDarkEmailDocument } = require("./emailDocumentWrapper");
const { normalizePublicBaseUrl } = require("../utils/publicUrl");

const FALLBACK_PUBLIC_ORIGIN = "https://globalimports.app";
const DEFAULT_EMAIL_HEADER_URL = "https://res.cloudinary.com/duh2g4lo0/image/upload/global-app/email/tracking-header.jpg";
const DEFAULT_EMAIL_PREMIUM_URL = "https://res.cloudinary.com/duh2g4lo0/image/upload/global-app/email/tracking-premium.jpg";
const DEFAULT_EMAIL_VEHICLE_ICON_URL = "https://res.cloudinary.com/duh2g4lo0/image/upload/global-app/email/vehicle-icon.png";
const DEFAULT_EMAIL_FOOTER_URL = "https://res.cloudinary.com/duh2g4lo0/image/upload/global-app/email/tracking-footer.jpg";
const GOLD = "#c4a36a";
const GOLD_SOFT = "rgba(196,163,106,0.38)";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEmailParagraphs(value) {
  return escapeHtml(value)
    .split(/\n+/)
    .filter(Boolean)
    .join("<br /><br />");
}

function resolvePublicOrigin() {
  const candidates = [
    process.env.PUBLIC_APP_URL,
    process.env.APP_BASE_URL,
    process.env.CORS_ORIGIN,
    FALLBACK_PUBLIC_ORIGIN,
  ]
    .flatMap((value) => String(value || "").split(/[\s,]+/))
    .map((value) => normalizePublicBaseUrl(value))
    .filter(Boolean);

  const preferred = candidates.find((url) => {
    try {
      return /(?:^|\.)globalimports\.app$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });

  return preferred || candidates[0] || FALLBACK_PUBLIC_ORIGIN;
}

function resolveTrackingUrl(trackingNumber) {
  const baseUrl = resolvePublicOrigin();
  const safeTracking = String(trackingNumber || "").trim().toUpperCase();

  if (!baseUrl || !safeTracking) {
    return "";
  }

  const trackingUrl = new URL("/client-tracking.html", `${baseUrl}/`);
  trackingUrl.searchParams.set("tracking", safeTracking);
  return trackingUrl.toString();
}

function resolveEmailAssetUrl(pathname) {
  return new URL(pathname, `${resolvePublicOrigin()}/`).toString();
}

function goldIconCircle(symbol, { align = "left" } = {}) {
  const centered = align === "center";
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="${centered ? "center" : "left"}" style="border-collapse:collapse;${centered ? "margin:0 auto;" : ""}">
    <tr>
      <td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:22px;background:${GOLD};color:#111111;font-size:18px;font-weight:800;line-height:44px;">
        ${symbol}
      </td>
    </tr>
  </table>`;
}

function buildTrackingUpdateEmailHtml({
  recipientName,
  trackingNumber,
  vehicleLabel,
  nextStateLabel,
  stepNotes,
  currentStepNumber,
  totalSteps,
  trackingUrl,
  logoUrl,
  headerUrl,
  premiumUrl,
  vehicleIconUrl,
  footerUrl,
} = {}) {
  const safeRecipientName = escapeHtml(String(recipientName || "Cliente").trim() || "Cliente");
  const safeTrackingNumber = escapeHtml(String(trackingNumber || "").trim());
  const safeVehicleLabel = escapeHtml(String(vehicleLabel || "tu vehículo").trim());
  const resolvedTotalSteps = Math.max(1, Number(totalSteps) || 10);
  const resolvedCurrentStep = Math.min(
    resolvedTotalSteps,
    Math.max(1, Number(currentStepNumber) || 1)
  );
  const safeProgress = escapeHtml(`${resolvedCurrentStep}/${resolvedTotalSteps}`);
  const safeNotes = formatEmailParagraphs(
    String(stepNotes || "Tu vehículo sigue avanzando dentro del proceso de importación.").trim()
  );
  const safeTrackingUrl = String(trackingUrl || "").trim();
  const safeHeaderUrl = String(headerUrl || DEFAULT_EMAIL_HEADER_URL).trim();
  const safePremiumUrl = String(premiumUrl || DEFAULT_EMAIL_PREMIUM_URL).trim();
  const safeVehicleIconUrl = String(vehicleIconUrl || DEFAULT_EMAIL_VEHICLE_ICON_URL).trim();
  const safeFooterUrl = String(footerUrl || DEFAULT_EMAIL_FOOTER_URL).trim();
  const hasTrackingUrl = Boolean(safeTrackingUrl);

  return wrapDarkEmailDocument(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050505" style="margin:0;padding:0;background:#050505;width:100%;">
      <tr>
        <td align="center" style="padding:28px 12px;background:#050505;">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#f6f4ef;">
            <tr>
              <td style="padding:0 0 22px;">
                <img src="${escapeHtml(safeHeaderUrl)}" alt="Global Imports Tracking" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />
              </td>
            </tr>

            <tr>
              <td style="padding:8px 8px 6px;">
                <div class="em-heading" style="margin:0;font-size:34px;line-height:1.05;letter-spacing:-0.03em;text-transform:uppercase;color:#ffffff;font-weight:800;">
                  Tu pedido tiene
                </div>
                <div class="em-gold" style="margin:6px 0 0;font-size:34px;line-height:1.05;letter-spacing:-0.03em;text-transform:uppercase;color:${GOLD};font-weight:800;">
                  una nueva actualización
                </div>
              </td>
            </tr>

            <tr>
              <td class="em-secondary" style="padding:16px 8px 22px;color:#e8e0d4;font-size:16px;line-height:1.7;">
                Hola ${safeRecipientName}, ya registramos un nuevo avance en el proceso de tu vehículo. Ya está más cerca de tus manos.
              </td>
            </tr>

            <tr>
              <td style="padding:0 8px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#141210;border:1px solid ${GOLD_SOFT};border-radius:22px;">
                  <tr>
                    <td style="padding:22px 22px 20px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td valign="top" width="56" style="width:56px;padding-right:14px;">
                            <img src="${escapeHtml(safeVehicleIconUrl)}" alt="Pedido" width="44" height="44" style="display:block;width:44px;height:44px;border:0;border-radius:8px;" />
                          </td>
                          <td valign="top">
                            <div class="em-gold" style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${GOLD};margin-bottom:8px;">
                              Tracking ${safeTrackingNumber}
                            </div>
                            <div class="em-heading" style="font-size:26px;line-height:1.15;color:#ffffff;font-weight:800;text-transform:uppercase;">
                              ${safeVehicleLabel}
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 8px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:12px 0;">
                  <tr>
                    <td width="50%" valign="top" align="center" style="width:50%;background:#141210;border:1px solid ${GOLD_SOFT};border-radius:18px;padding:18px 14px;">
                      ${goldIconCircle("⚑", { align: "center" })}
                      <div class="em-gold" style="margin-top:12px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${GOLD};">Estado actual</div>
                      <div class="em-heading" style="margin-top:6px;color:#ffffff;font-size:28px;line-height:1.1;font-weight:800;">${safeProgress}</div>
                    </td>
                    <td width="50%" valign="top" align="center" style="width:50%;background:#141210;border:1px solid ${GOLD_SOFT};border-radius:18px;padding:18px 14px;">
                      ${goldIconCircle("✓", { align: "center" })}
                      <div class="em-gold" style="margin-top:12px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${GOLD};">Detalle</div>
                      <div class="em-heading" style="margin-top:6px;color:#ffffff;font-size:14px;line-height:1.45;font-weight:700;">${safeNotes}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 0 18px;">
                <img src="${escapeHtml(safePremiumUrl)}" alt="Seguimiento premium en tiempo real" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />
              </td>
            </tr>

            ${
              hasTrackingUrl
                ? `<tr>
              <td align="center" style="padding:6px 8px 10px;">
                <a class="em-btn" href="${escapeHtml(safeTrackingUrl)}" style="display:inline-block;padding:16px 36px;border-radius:999px;background:${GOLD};color:#15110a;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;">
                  Ver seguimiento
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" class="em-muted" style="padding:0 18px 22px;color:#d7d0c5;font-size:12px;line-height:1.7;word-break:break-word;">
                Si el botón no abre, copia este enlace en tu navegador:<br />
                <span class="em-secondary" style="color:#e8e0d4;">${escapeHtml(safeTrackingUrl)}</span>
              </td>
            </tr>`
                : ""
            }

            <tr>
              <td style="padding:8px 0 0;">
                <img src="${escapeHtml(safeFooterUrl)}" alt="Global Imports. Excelencia en cada importación. Este correo fue enviado desde orders@globalimportsus.com para mantenerte informado sobre el progreso de tu importación." width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `);
}

async function sendOrderTrackingUpdateEmail({
  toEmail,
  toName,
  trackingNumber,
  vehicleLabel,
  nextStateLabel,
  stepNotes,
  currentStepNumber,
  totalSteps,
}) {
  const safeTrackingNumber = String(trackingNumber || "").trim();
  const safeNextStateLabel = String(nextStateLabel || "Actualización").trim();

  return sendBrevoEmail({
    toEmail,
    toName: toName || toEmail,
    senderName: "Global Imports Orders",
    senderEmail: "orders@globalimportsus.com",
    subject: `Actualización de tu pedido ${safeTrackingNumber} | ${safeNextStateLabel}`,
    htmlContent: buildTrackingUpdateEmailHtml({
      recipientName: toName,
      trackingNumber: safeTrackingNumber,
      vehicleLabel,
      nextStateLabel: safeNextStateLabel,
      stepNotes,
      currentStepNumber,
      totalSteps,
      trackingUrl: resolveTrackingUrl(safeTrackingNumber),
      headerUrl: DEFAULT_EMAIL_HEADER_URL,
      premiumUrl: DEFAULT_EMAIL_PREMIUM_URL,
      vehicleIconUrl: DEFAULT_EMAIL_VEHICLE_ICON_URL,
      footerUrl: DEFAULT_EMAIL_FOOTER_URL,
    }),
  });
}

module.exports = {
  sendOrderTrackingUpdateEmail,
  buildTrackingUpdateEmailHtml,
  resolveTrackingUrl,
};
