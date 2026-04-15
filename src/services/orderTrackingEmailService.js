const { sendBrevoEmail } = require("./brevoEmailService");

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

function resolveTrackingUrl(trackingNumber) {
  const baseUrl = String(
    process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || process.env.CORS_ORIGIN || ""
  )
    .trim()
    .replace(/\/$/, "");

  if (!baseUrl || !trackingNumber) {
    return "";
  }

  const trackingUrl = new URL("/client-tracking.html", `${baseUrl}/`);
  trackingUrl.searchParams.set("tracking", String(trackingNumber).trim().toUpperCase());
  return trackingUrl.toString();
}

function buildTrackingUpdateEmailHtml({
  recipientName,
  trackingNumber,
  vehicleLabel,
  previousStateLabel,
  nextStateLabel,
  stepNotes,
  trackingUrl,
}) {
  const safeRecipientName = escapeHtml(String(recipientName || "Cliente").trim() || "Cliente");
  const safeTrackingNumber = escapeHtml(String(trackingNumber || "").trim());
  const safeVehicleLabel = escapeHtml(String(vehicleLabel || "tu vehículo").trim());
  const safePreviousState = escapeHtml(String(previousStateLabel || "inicio del proceso").trim());
  const safeNextState = escapeHtml(String(nextStateLabel || "nuevo estado").trim());
  const safeNotes = formatEmailParagraphs(
    String(stepNotes || "Seguimos moviendo cada detalle para acercarte a tu vehículo.").trim()
  );
  const safeTrackingUrl = String(trackingUrl || "").trim();
  const hasTrackingUrl = Boolean(safeTrackingUrl);

  return `
    <div style="margin:0;padding:0;background:#060606;font-family:Manrope,Arial,sans-serif;color:#f6f4ef;">
      <div style="max-width:640px;margin:0 auto;padding:30px 18px;">
        <div style="border:1px solid rgba(216,170,82,0.22);border-radius:30px;overflow:hidden;background:linear-gradient(180deg,#121214 0%,#0b0b0c 100%);box-shadow:0 28px 70px rgba(0,0,0,0.45);">
          <div style="padding:38px 34px 22px;background:radial-gradient(circle at top right, rgba(216,170,82,0.17), transparent 34%),linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0));">
            <div style="display:inline-block;padding:8px 14px;border:1px solid rgba(216,170,82,0.24);border-radius:999px;color:#f1d9a6;font-size:12px;letter-spacing:.18em;text-transform:uppercase;">
              Global Imports Tracking
            </div>
            <h1 style="margin:18px 0 12px;font-family:Syne,Arial,sans-serif;font-size:36px;line-height:1.02;letter-spacing:-0.04em;color:#ffffff;">
              Tu pedido tiene una nueva actualización
            </h1>
            <p style="margin:0;color:#c9c3b8;font-size:16px;line-height:1.75;">
              Hola ${safeRecipientName}, ya registramos un nuevo avance en el proceso de <strong style="color:#ffffff;">${safeVehicleLabel}</strong>.
            </p>
          </div>

          <div style="padding:10px 34px 20px;">
            <div style="padding:24px;border-radius:24px;background:linear-gradient(180deg, rgba(216,170,82,0.16), rgba(216,170,82,0.05));border:1px solid rgba(216,170,82,0.22);margin-bottom:18px;">
              <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#f1d9a6;margin-bottom:10px;">Tracking ${safeTrackingNumber}</div>
              <div style="font-family:Syne,Arial,sans-serif;font-size:28px;line-height:1.1;color:#ffffff;margin-bottom:10px;">
                ${safePreviousState} → ${safeNextState}
              </div>
              <p style="margin:0;color:#f2eee5;font-size:15px;line-height:1.8;">
                ${safeNotes}
              </p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px;">
              <div style="padding:18px 18px 16px;border-radius:20px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a9a49a;margin-bottom:8px;">Pedido</div>
                <div style="color:#ffffff;font-size:16px;line-height:1.6;font-weight:700;">${safeVehicleLabel}</div>
              </div>
              <div style="padding:18px 18px 16px;border-radius:20px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.06);">
                <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#a9a49a;margin-bottom:8px;">Siguiente paso</div>
                <div style="color:#ffffff;font-size:16px;line-height:1.6;font-weight:700;">${safeNextState}</div>
              </div>
            </div>

            <div style="padding:22px 24px;border-radius:22px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0 0 10px;color:#ffffff;font-size:15px;font-weight:700;">Seguimiento premium en tiempo real</p>
              <p style="margin:0;color:#b8b3aa;font-size:14px;line-height:1.85;">
                Cada cambio de estado significa que estamos un paso más cerca de entregarte tu vehículo. Seguimos cuidando el proceso con trazabilidad, precisión y comunicación constante.
              </p>
            </div>

            ${
              hasTrackingUrl
                ? `<div style="padding-top:20px;text-align:center;">
              <a href="${safeTrackingUrl}" style="display:inline-block;padding:16px 24px;border-radius:999px;background:#d8aa52;color:#15110a;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;">Ver seguimiento</a>
              <p style="margin:16px 0 0;color:#8f908f;font-size:12px;line-height:1.7;word-break:break-word;">Si el botón no abre, copia este enlace en tu navegador:<br /><span style="color:#c9c3b8;">${escapeHtml(
                safeTrackingUrl
              )}</span></p>
            </div>`
                : ""
            }
          </div>

          <div style="padding:24px 34px 34px;border-top:1px solid rgba(255,255,255,0.06);color:#8f908f;font-size:12px;line-height:1.8;">
            Este correo fue enviado por Global Imports desde orders@globalimportsus.com para mantenerte informado sobre el progreso de tu importación.
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendOrderTrackingUpdateEmail({ toEmail, toName, trackingNumber, vehicleLabel, previousStateLabel, nextStateLabel, stepNotes }) {
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
      previousStateLabel,
      nextStateLabel: safeNextStateLabel,
      stepNotes,
      trackingUrl: resolveTrackingUrl(safeTrackingNumber),
    }),
  });
}

module.exports = {
  sendOrderTrackingUpdateEmail,
};