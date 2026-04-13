function buildTrackingUpdateEmailHtml({ recipientName, trackingNumber, vehicleLabel, previousStateLabel, nextStateLabel, stepNotes }) {
  const safeRecipientName = String(recipientName || "Cliente").trim() || "Cliente";
  const safeTrackingNumber = String(trackingNumber || "").trim();
  const safeVehicleLabel = String(vehicleLabel || "tu vehículo").trim();
  const safePreviousState = String(previousStateLabel || "inicio del proceso").trim();
  const safeNextState = String(nextStateLabel || "nuevo estado").trim();
  const safeNotes = String(stepNotes || "Seguimos moviendo cada detalle para acercarte a tu vehículo.").trim();

  return `
    <div style="margin:0;padding:0;background:#060606;font-family:Manrope,Arial,sans-serif;color:#f6f4ef;">
      <div style="max-width:640px;margin:0 auto;padding:30px 18px;">
        <div style="border:1px solid rgba(216,170,82,0.22);border-radius:30px;overflow:hidden;background:linear-gradient(180deg,#121214 0%,#0b0b0c 100%);box-shadow:0 28px 70px rgba(0,0,0,0.45);">
          <div style="padding:38px 34px 22px;background:radial-gradient(circle at top right, rgba(216,170,82,0.17), transparent 34%),linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0));">
            <div style="display:inline-block;padding:8px 14px;border:1px solid rgba(216,170,82,0.24);border-radius:999px;color:#f1d9a6;font-size:12px;letter-spacing:.18em;text-transform:uppercase;">
              Global Imports Tracking
            </div>
            <h1 style="margin:18px 0 12px;font-family:Syne,Arial,sans-serif;font-size:36px;line-height:1.02;letter-spacing:-0.04em;color:#ffffff;">
              Tu vehículo sigue avanzando
            </h1>
            <p style="margin:0;color:#c9c3b8;font-size:16px;line-height:1.75;">
              Hola ${safeRecipientName}, tenemos una nueva actualización emocionante sobre <strong style="color:#ffffff;">${safeVehicleLabel}</strong>.
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

            <div style="padding:22px 24px;border-radius:22px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0 0 10px;color:#ffffff;font-size:15px;font-weight:700;">Lo mejor: tu proceso sigue en movimiento</p>
              <p style="margin:0;color:#b8b3aa;font-size:14px;line-height:1.85;">
                Cada cambio de estado significa que estamos un paso más cerca de entregarte ese vehículo que vienes esperando. Gracias por confiar en Global Imports para traerlo hasta ti con seguimiento, precisión y cuidado.
              </p>
            </div>
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
  const apiKey = String(process.env.BREVO_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error("Missing BREVO_API_KEY env var");
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: "Global Imports Orders",
        email: "orders@globalimportsus.com",
      },
      to: [{ email: toEmail, name: toName || toEmail }],
      subject: `Tu tracking ${trackingNumber} avanzó a ${nextStateLabel}`,
      htmlContent: buildTrackingUpdateEmailHtml({
        recipientName: toName,
        trackingNumber,
        vehicleLabel,
        previousStateLabel,
        nextStateLabel,
        stepNotes,
      }),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.code || "Brevo tracking email request failed");
  }

  return data;
}

module.exports = {
  sendOrderTrackingUpdateEmail,
};