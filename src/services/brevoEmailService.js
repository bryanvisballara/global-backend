function buildVerificationEmailHtml({ name, verificationCode }) {
  const safeName = String(name || "Cliente").trim() || "Cliente";

  return `
    <div style="margin:0;padding:0;background:#060606;font-family:Manrope,Arial,sans-serif;color:#f6f4ef;">
      <div style="max-width:620px;margin:0 auto;padding:32px 18px;">
        <div style="border:1px solid rgba(216,170,82,0.22);border-radius:30px;overflow:hidden;background:linear-gradient(180deg,#111214 0%,#0a0a0b 100%);box-shadow:0 24px 60px rgba(0,0,0,0.45);">
          <div style="padding:40px 36px 22px;background:radial-gradient(circle at top right, rgba(216,170,82,0.18), transparent 34%),linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0));">
            <div style="display:inline-block;padding:8px 14px;border:1px solid rgba(216,170,82,0.24);border-radius:999px;color:#f1d9a6;font-size:12px;letter-spacing:.18em;text-transform:uppercase;">
              Global Imports
            </div>
            <h1 style="margin:18px 0 12px;font-family:Syne,Arial,sans-serif;font-size:36px;line-height:1.02;letter-spacing:-0.04em;color:#ffffff;">
              Verifica tu cuenta
            </h1>
            <p style="margin:0;color:#c9c3b8;font-size:16px;line-height:1.7;">
              Hola ${safeName}, usa este código para confirmar tu registro y activar tu acceso seguro en Global Imports.
            </p>
          </div>

          <div style="padding:8px 36px 18px;">
            <div style="margin:18px 0 22px;padding:26px;border-radius:24px;background:linear-gradient(180deg, rgba(216,170,82,0.16), rgba(216,170,82,0.06));border:1px solid rgba(216,170,82,0.24);text-align:center;">
              <div style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#f1d9a6;margin-bottom:12px;">Código de verificación</div>
              <div style="font-family:Syne,Arial,sans-serif;font-size:42px;line-height:1;letter-spacing:.28em;color:#ffffff;font-weight:800;">${verificationCode}</div>
            </div>

            <div style="padding:22px 24px;border-radius:22px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0 0 10px;color:#f7f7f4;font-size:15px;font-weight:700;">Detalles importantes</p>
              <p style="margin:0;color:#b8b3aa;font-size:14px;line-height:1.8;">
                Este código vence en <strong style="color:#ffffff;">10 minutos</strong>.<br />
                Si no solicitaste esta cuenta, puedes ignorar este mensaje con tranquilidad.
              </p>
            </div>
          </div>

          <div style="padding:24px 36px 34px;border-top:1px solid rgba(255,255,255,0.06);color:#8f908f;font-size:12px;line-height:1.8;">
            © Global Imports. Experiencia premium, atención precisa y comunicación segura.
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendRegistrationVerificationEmail({ toEmail, toName, verificationCode }) {
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
        name: "Global Imports",
        email: "verify@globalimportsus.com",
      },
      to: [{ email: toEmail, name: toName }],
      subject: "Tu código de verificación | Global Imports",
      htmlContent: buildVerificationEmailHtml({
        name: toName,
        verificationCode,
      }),
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.code || "Brevo email request failed");
  }

  return data;
}

module.exports = {
  sendRegistrationVerificationEmail,
};