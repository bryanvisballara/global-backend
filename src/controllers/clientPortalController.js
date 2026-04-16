const crypto = require("crypto");
// Webhook público para Wompi
async function wompiWebhookHandler(req, res) {
  try {
    const integritySecret = String(process.env.WOMPI_INTEGRITY_SECRET || "").trim();
    if (!integritySecret) {
      return res.status(503).json({ message: "WOMPI_INTEGRITY_SECRET no configurado" });
    }

    const signature = req.headers["x-integrity"] || req.headers["x-wompi-signature"] || req.headers["x-wompi-integrity"] || "";
    const rawBody = req.rawBody || req.bodyRaw || req.body || "";
    let bodyString = "";
    if (typeof rawBody === "string") {
      bodyString = rawBody;
    } else if (Buffer.isBuffer(rawBody)) {
      bodyString = rawBody.toString("utf8");
    } else if (typeof rawBody === "object") {
      bodyString = JSON.stringify(rawBody);
    }

    const expectedSignature = crypto
      .createHmac("sha256", integritySecret)
      .update(bodyString)
      .digest("hex");

    if (!signature || signature !== expectedSignature) {
      return res.status(401).json({ message: "Firma de integridad inválida" });
    }

    const event = typeof rawBody === "object" ? rawBody : JSON.parse(bodyString);
    const eventType = String(event?.event || event?.type || "").toLowerCase();
    const transaction = event?.data?.transaction || event?.transaction || {};

    if (eventType !== "transaction.updated" && eventType !== "transaction.created") {
      return res.status(200).json({ message: "Evento ignorado" });
    }

    if (String(transaction?.status || "").toUpperCase() !== "APPROVED") {
      return res.status(200).json({ message: "Transacción no aprobada" });
    }

    // Simula req.user para confirmWompiPaymentAndCreateOrder
    req.user = {
      name: transaction?.customer_email || "Cliente Wompi",
      email: transaction?.customer_email || "",
      phone: transaction?.customer_phone || "",
      identification: transaction?.customer_legal_id || "",
      _id: null,
    };
    req.body = {
      transactionId: transaction?.id,
      status: transaction?.status,
      reference: transaction?.reference,
      brand: transaction?.brand,
      model: transaction?.model,
      version: transaction?.version,
      extColor: transaction?.extColor,
      intColor: transaction?.intColor,
      city: transaction?.city,
      vehicle: transaction?.vehicle || {},
    };

    // Llama la lógica de confirmación y creación de orden
    return await confirmWompiPaymentAndCreateOrder(req, res);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error en webhook Wompi" });
  }
}
const ClientRequest = require("../models/ClientRequest");
const Client = require("../models/Client");
const ClientGlobalUS = require("../models/ClientGlobalUS");
const ClientMaintenanceVehicle = require("../models/ClientMaintenanceVehicle");
const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const OrderGlobalUS = require("../models/OrderGlobalUS");
const Post = require("../models/Post");
const VirtualShowcaseVehicle = require("../models/VirtualShowcaseVehicle");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { normalizeTrackingStates } = require("../constants/trackingSteps");
const { publishDueScheduledPosts } = require("./adminPostsController");
const {
  hydrateOrderTracking,
  hydrateOrdersTracking,
} = require("../services/trackingEventService");

function getDocuSignOAuthBaseUrl() {
  const envName = String(process.env.DOCUSIGN_ENV || "sandbox").toLowerCase();
  return envName === "production"
    ? "https://account.docusign.com"
    : "https://account-d.docusign.com";
}

function getDocuSignApiBaseUrl(baseUri) {
  const envName = String(process.env.DOCUSIGN_ENV || "sandbox").toLowerCase();

  if (baseUri) {
    return `${String(baseUri).replace(/\/+$/, "")}/restapi`;
  }

  return envName === "production"
    ? "https://www.docusign.net/restapi"
    : "https://demo.docusign.net/restapi";
}

function getRequiredDocuSignConfig() {
  const integrationKey = String(process.env.DOCUSIGN_INTEGRATION_KEY || "").trim();
  const userId = String(process.env.DOCUSIGN_USER_ID || "").trim();
  const privateKeyRaw = String(process.env.DOCUSIGN_PRIVATE_KEY || "").trim();
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (!integrationKey || !userId || !privateKey) {
    throw new Error("DocuSign no está configurado. Faltan DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID o DOCUSIGN_PRIVATE_KEY.");
  }

  return {
    integrationKey,
    userId,
    privateKey,
    accountId: String(process.env.DOCUSIGN_ACCOUNT_ID || "").trim(),
    returnUrl: String(process.env.DOCUSIGN_RETURN_URL || "").trim(),
    consentRedirectUrl: String(process.env.DOCUSIGN_CONSENT_REDIRECT_URL || "").trim(),
  };
}

function buildDocuSignConsentUrl(config) {
  const redirectUrl = String(config?.consentRedirectUrl || config?.returnUrl || "").trim();

  if (!config?.integrationKey || !redirectUrl) {
    return "";
  }

  const oauthBaseUrl = getDocuSignOAuthBaseUrl();
  const consentUrl = new URL(`${oauthBaseUrl}/oauth/auth`);
  consentUrl.searchParams.set("response_type", "code");
  consentUrl.searchParams.set("scope", "signature impersonation");
  consentUrl.searchParams.set("client_id", config.integrationKey);
  consentUrl.searchParams.set("redirect_uri", redirectUrl);

  return consentUrl.toString();
}

async function getDocuSignAccessToken(config) {
  const oauthBaseUrl = getDocuSignOAuthBaseUrl();
  const assertion = jwt.sign(
    {
      iss: config.integrationKey,
      sub: config.userId,
      aud: oauthBaseUrl.replace(/^https?:\/\//, ""),
      scope: "signature impersonation",
    },
    config.privateKey,
    {
      algorithm: "RS256",
      expiresIn: "1h",
    }
  );

  const tokenResponse = await fetch(`${oauthBaseUrl}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    const errorCode = String(tokenData.error || "").trim().toLowerCase();

    if (errorCode === "consent_required") {
      const consentUrl = buildDocuSignConsentUrl(config);
      const consentError = new Error(
        consentUrl
          ? `DocuSign requiere consentimiento JWT para esta integración. Ábrelo una vez y vuelve a intentar: ${consentUrl}`
          : "DocuSign requiere consentimiento JWT para esta integración. Configura DOCUSIGN_CONSENT_REDIRECT_URL y otorga el consentimiento una vez en DocuSign."
      );

      consentError.code = "consent_required";
      consentError.consentUrl = consentUrl;
      throw consentError;
    }

    throw new Error(tokenData.error_description || tokenData.error || "No se pudo autenticar en DocuSign.");
  }

  return tokenData.access_token;
}

function buildPreagreementHtml(contractPayload = {}) {
  const now = new Date();
  const generatedDate = now.toLocaleDateString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const {
    vehicle = {},
    deliveryCity = "No especificada",
    totalPriceLabel = "No especificado",
    reservationAmountLabel = "No especificado",
  } = contractPayload;

  return `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <style>
      body { font-family: Arial, sans-serif; color: #1f2937; margin: 32px; line-height: 1.55; }
      h1, h2, h3 { margin: 0 0 10px; }
      h1 { font-size: 21px; text-align: center; }
      h2 { font-size: 15px; margin-top: 26px; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; }
      h3 { font-size: 13px; margin-top: 18px; }
      p { margin: 8px 0; font-size: 13px; text-align: justify; }
      .box { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin-top: 10px; }
      .label { font-weight: 700; }
      .line { border-bottom: 1px dashed #9ca3af; min-height: 20px; display: inline-block; min-width: 260px; }
      .small { color: #4b5563; font-size: 12px; text-align: center; }
      .clause { margin-top: 14px; }
      .clause-title { font-weight: 700; font-size: 13px; display: block; margin-bottom: 4px; }
      .note { background: #f9fafb; border-left: 3px solid #6b7280; padding: 8px 12px; font-size: 12px; color: #374151; margin-top: 10px; }
      .sign-area { margin-top: 30px; padding-top: 12px; border-top: 2px solid #e5e7eb; }
      .parties { display: flex; gap: 40px; margin-top: 10px; }
      .party { flex: 1; }
      .anchor { color: white; font-size: 1pt; line-height: 0; display: inline-block; }
      .field-group { margin: 12px 0; }
      .field-label { font-weight: 700; font-size: 13px; margin-bottom: 2px; }
      .field-line { border-bottom: 1px dashed #9ca3af; min-height: 28px; padding: 2px 4px; }
    </style>
  </head>
  <body>
    <h1>Preacuerdo de Responsabilidad y Compromiso de Compra</h1>
    <p class="small">Documento generado el ${generatedDate}</p>
    <br/>

    <p>
      Entre <strong>GLOBAL IMPORTS S.A.S.</strong> (en adelante <em>"GLOBAL IMPORTS"</em>), sociedad comercial
      legalmente constituida conforme a las leyes colombianas, con domicilio en la República de Colombia,
      y el <strong>CLIENTE</strong> cuyos datos se relacionan a continuación, se celebra el presente
      Preacuerdo de Responsabilidad y Compromiso de Compra, el cual se regirá por las disposiciones del
      Código Civil Colombiano, el Código de Comercio (Decreto 410 de 1971), la Ley 1480 de 2011
      (Estatuto del Consumidor) y demás normas concordantes.
    </p>

    <h2>I. Identificación de las partes</h2>

    <div class="field-group">
      <p class="field-label">Nombre completo del cliente:</p>
      <div class="field-line"><span class="anchor">/full_name/</span></div>
    </div>
    <div class="field-group">
      <p class="field-label">Tipo de documento de identidad:</p>
      <div class="field-line"><span class="anchor">/doc_type/</span></div>
    </div>
    <div class="field-group">
      <p class="field-label">Número de documento de identidad:</p>
      <div class="field-line"><span class="anchor">/doc_number/</span></div>
    </div>
    <div class="field-group">
      <p class="field-label">Fecha de suscripción del preacuerdo:</p>
      <div class="field-line"><span class="anchor">/sign_date/</span></div>
    </div>

    <h2>II. Especificaciones del vehículo objeto del preacuerdo</h2>
    <div class="box">
      <p><span class="label">Marca:</span> ${String(vehicle.brand || "-")}</p>
      <p><span class="label">Modelo:</span> ${String(vehicle.model || "-")}</p>
      <p><span class="label">Versión / Trim:</span> ${String(vehicle.version || "-")}</p>
      <p><span class="label">Color exterior:</span> ${String(vehicle.exteriorColor || "-")}</p>
      <p><span class="label">Color interior:</span> ${String(vehicle.interiorColor || "-")}</p>
      <p><span class="label">Ciudad de entrega pactada:</span> ${String(deliveryCity || "-")}</p>
      <p><span class="label">Precio total estimado (COP):</span> ${String(totalPriceLabel || "-")}</p>
      <p><span class="label">Valor de reserva (arras):</span> ${String(reservationAmountLabel || "-")}</p>
    </div>

    <h2>III. Cláusulas y condiciones</h2>

    <div class="clause">
      <span class="clause-title">CLÁUSULA PRIMERA — Naturaleza del pago inicial (Arras Penitenciales)</span>
      <p>
        El CLIENTE realiza un pago inicial de <strong>UN MILLÓN DE PESOS MONEDA CORRIENTE ($1.000.000 COP)</strong>
        en calidad de <em>arras penitenciales</em>, de conformidad con el artículo 1859 del Código Civil
        Colombiano, como señal de seriedad, reserva exclusiva y compromiso formal de compra del vehículo
        descrito en la Sección II. Este valor quedará en custodia de GLOBAL IMPORTS como condición habilitante
        del proceso de consecución e importación del vehículo.
      </p>
      <div class="note">Fundamento legal: Código Civil Colombiano, art. 1859; Código de Comercio,
      arts. 864 y 871 (obligatoriedad del acuerdo y buena fe contractual).</div>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA SEGUNDA — Plazo para la formalización del contrato de compraventa</span>
      <p>
        El CLIENTE dispondrá de <strong>quince (15) días calendario</strong> contados a partir de la fecha de
        suscripción del presente documento para efectuar el pago de
        <strong>NOVENTA Y NUEVE MILLONES DE PESOS MONEDA CORRIENTE ($99.000.000 COP)</strong>, con el fin de
        formalizar el contrato definitivo de compraventa del vehículo.
      </p>
      <p>
        <strong>Consecuencia del incumplimiento por parte del CLIENTE:</strong> Si transcurrido el plazo de
        quince (15) días el CLIENTE no efectúa el pago de formalización sin causa justificada imputable a
        GLOBAL IMPORTS, perderá en favor de esta última la totalidad del valor entregado como arras
        ($1.000.000 COP), sin que haya lugar a devolución, reintegro ni compensación alguna.
        Esta consecuencia opera de pleno derecho sin necesidad de declaración judicial previa,
        de conformidad con el artículo 1859 del Código Civil y el artículo 864 del Código de Comercio.
      </p>
      <div class="note">Fundamento legal: Código Civil, art. 1859; Código de Comercio (Decreto 410/1971),
      arts. 864 y 871; Ley 1480 de 2011, art. 3 (principios de buena fe y responsabilidad).</div>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA TERCERA — Obligaciones de GLOBAL IMPORTS y plazo de consecución</span>
      <p>
        GLOBAL IMPORTS se compromete a gestionar activamente la consecución e importación del vehículo con
        las especificaciones exactas pactadas en la Sección II del presente documento, dentro del plazo de
        <strong>quince (15) días calendario</strong> contados desde la fecha de suscripción.
      </p>
      <p>
        En caso de que GLOBAL IMPORTS no logre obtener el vehículo con las características exactas ordenadas
        por el CLIENTE dentro del plazo señalado, deberá notificar al CLIENTE por escrito o por medios
        electrónicos verificables y ofrecerle <strong>opciones alternativas</strong> de vehículos de similares
        especificaciones técnicas, versión y valor comercial, de conformidad con el deber de información
        consagrado en el artículo 23 de la Ley 1480 de 2011.
      </p>
      <div class="note">Fundamento legal: Ley 1480 de 2011 (Estatuto del Consumidor), arts. 3, 7, 11 y 23;
      Código de Comercio, art. 871 (buena fe objetiva).</div>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA CUARTA — Derecho al reembolso total por incumplimiento de GLOBAL IMPORTS</span>
      <p>
        Si el CLIENTE, habiendo recibido las alternativas contempladas en la Cláusula Tercera, manifiesta
        que requiere el vehículo con las especificaciones exactas originalmente pactadas y GLOBAL IMPORTS
        no pudo conseguirlo dentro del plazo de quince (15) días, el CLIENTE tendrá derecho a desistir
        del presente preacuerdo y exigir la <strong>devolución total del dinero entregado</strong>
        ($1.000.000 COP), sin penalización ni descuento alguno.
      </p>
      <p>
        GLOBAL IMPORTS procederá a efectuar la devolución dentro de los <strong>cinco (5) días hábiles</strong>
        siguientes a la comunicación escrita del desistimiento por parte del CLIENTE, mediante transferencia
        bancaria al número de cuenta indicado por este. El incumplimiento de este plazo de devolución
        causará intereses de mora a la tasa máxima legal permitida.
      </p>
      <div class="note">Fundamento legal: Ley 1480 de 2011, arts. 7 (garantías) y 11 (reversión del pago);
      Código Civil, art. 1617 (intereses de mora); Superintendencia de Industria y Comercio —
      Concepto 05083549 sobre reembolso por incumplimiento del proveedor.</div>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA QUINTA — Declaraciones del cliente</span>
      <p>
        El CLIENTE declara bajo la gravedad del juramento que: (i) la información suministrada en este
        documento es veraz, completa y corresponde a su identidad real; (ii) tiene plena capacidad legal
        para suscribir el presente preacuerdo; (iii) comprende el alcance y las consecuencias jurídicas
        de las cláusulas aquí contenidas; y (iv) acepta las condiciones del presente preacuerdo de manera
        libre, voluntaria y sin presión alguna.
      </p>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA SEXTA — Validez de la firma electrónica</span>
      <p>
        La firma electrónica del presente documento tiene plena validez y eficacia jurídica de conformidad
        con la Ley 527 de 1999 (sobre comercio electrónico y firmas digitales en Colombia), el Decreto
        2364 de 2012 y las directrices de la Superintendencia de Industria y Comercio. Las partes aceptan
        expresamente que la firma electrónica producirá los mismos efectos que la firma manuscrita.
      </p>
      <div class="note">Fundamento legal: Ley 527 de 1999, arts. 7 y 14; Decreto 2364 de 2012, art. 3.</div>
    </div>

    <div class="clause">
      <span class="clause-title">CLÁUSULA SÉPTIMA — Solución de controversias</span>
      <p>
        Cualquier controversia derivada del presente preacuerdo será resuelta, en primera instancia,
        mediante comunicación directa entre las partes. De no lograrse acuerdo, las partes podrán acudir
        a los mecanismos alternativos de solución de conflictos (conciliación) ante un Centro de
        Conciliación legalmente autorizado, sin perjuicio de las acciones ante la Superintendencia de
        Industria y Comercio en ejercicio de sus facultades jurisdiccionales (Ley 1480/2011, art. 56)
        o ante los jueces civiles competentes según la cuantía.
      </p>
    </div>

    <div class="sign-area">
      <p style="font-size:13px; margin-bottom:18px;">
        Las partes suscriben el presente Preacuerdo de Responsabilidad y Compromiso de Compra en señal
        de aceptación de todas y cada una de sus cláusulas, en la fecha indicada en la Sección I.
      </p>
      <div class="parties">
        <div class="party">
          <p class="label" style="font-size:13px;">Firma del CLIENTE</p>
          <div style="min-height:40px; display:flex; align-items:flex-end;"><span class="anchor">/sign_here/</span></div>
          <div class="field-group" style="margin-top:10px;">
            <p class="field-label" style="font-size:12px;">Nombre completo:</p>
            <div class="field-line"><span class="anchor">/full_name/</span></div>
          </div>
          <div class="field-group">
            <p class="field-label" style="font-size:12px;">C.C. / No. de documento:</p>
            <div class="field-line"><span class="anchor">/doc_number/</span></div>
          </div>
        </div>
        <div class="party">
          <p class="label" style="font-size:13px;">GLOBAL IMPORTS S.A.S.</p>
          <p style="font-size:12px; margin-top:4px; color:#4b5563;">Firma autorizada / Representante</p>
          <p style="border-bottom:1px dashed #9ca3af; min-height:36px; margin-top:8px;"></p>
        </div>
      </div>
    </div>
  </body>
</html>
  `.trim();
}

async function resolveDocuSignAccountData(accessToken, configuredAccountId = "") {
  const oauthBaseUrl = getDocuSignOAuthBaseUrl();

  const userInfoResponse = await fetch(`${oauthBaseUrl}/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const userInfoData = await userInfoResponse.json();

  if (!userInfoResponse.ok) {
    throw new Error(userInfoData.error_description || userInfoData.error || "No se pudo obtener la cuenta de DocuSign.");
  }

  const accounts = Array.isArray(userInfoData.accounts) ? userInfoData.accounts : [];
  const selectedAccount = configuredAccountId
    ? accounts.find((item) => String(item.account_id) === configuredAccountId)
    : accounts.find((item) => item.is_default) || accounts[0];

  if (!selectedAccount?.account_id) {
    throw new Error("No se encontró una cuenta válida en DocuSign.");
  }

  return {
    accountId: selectedAccount.account_id,
    baseUri: selectedAccount.base_uri,
  };
}

function buildNotifications(posts, orders, maintenanceItems) {
  const notifications = [];

  posts.slice(0, 4).forEach((post) => {
    notifications.push({
      id: `post-${post._id}`,
      type: "post",
      title: post.title,
      message: post.body,
      date: post.publishedAt || post.createdAt,
    });
  });

  orders.forEach((order) => {
    const stepWithUpdate = normalizeTrackingStates(order.trackingSteps || [])
      .flatMap((step) =>
        (step.updates || [])
          .filter((update) => update.clientVisible)
          .map((update) => ({
            key: step.key,
            label: step.label,
            notes: update.notes || "Tu orden tiene una nueva actualizacion.",
            date: update.updatedAt || update.createdAt || step.updatedAt || order.createdAt,
          }))
      )
      .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())[0];

    if (!stepWithUpdate) {
      return;
    }

    notifications.push({
      id: `tracking-${order._id}-${stepWithUpdate.key}`,
      type: "tracking",
      title: `Tracking ${order.trackingNumber}`,
      message: `${stepWithUpdate.label}: ${stepWithUpdate.notes}`,
      date: stepWithUpdate.date || order.createdAt,
    });
  });

  maintenanceItems.forEach((item) => {
    if (item.lastNotificationAt) {
      notifications.push({
        id: `maintenance-notification-${item._id}`,
        type: "maintenance",
        title: `Mantenimiento ${item.order?.trackingNumber || "activo"}`,
        message: item.contactNotes || "Global Imports te ha enviado una actualizacion de mantenimiento.",
        date: item.lastNotificationAt,
      });
    }

    if (item.status === "due") {
      notifications.push({
        id: `maintenance-due-${item._id}`,
        type: "maintenance",
        title: `Mantenimiento por vencer ${item.order?.trackingNumber || ""}`.trim(),
        message: "Tu mantenimiento preventivo ya necesita atencion.",
        date: item.dueDate,
      });
    }
  });

  return notifications
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
    .slice(0, 8);
}

function filterDismissedNotifications(notifications, dismissedNotifications = []) {
  const dismissedSet = new Set((dismissedNotifications || []).map((item) => String(item)));

  return (notifications || []).filter((item) => !dismissedSet.has(String(item.id)));
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const rawValue = String(value).trim();

  if (!rawValue) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
    return new Date(`${rawValue}T12:00:00.000Z`);
  }

  return new Date(rawValue);
}

function normalizeClientMaintenanceVehiclePayload(payload = {}) {
  const ALLOWED_DRIVING_CITIES = ["Barranquilla", "Bogota", "Bucaramanga", "Medellin", "Cali"];
  const brand = String(payload.brand || "").trim();
  const model = String(payload.model || "").trim();
  const version = payload.version ? String(payload.version).trim() : "";
  const plate = String(payload.plate || "").trim().toUpperCase();
  const drivingCity = String(payload.drivingCity || "").trim();

  const year = Number(payload.year);
  const currentMileage = Number(payload.currentMileage);
  const usualDailyKm = Number(payload.usualDailyKm);
  const lastPreventiveMaintenanceDate = parseDateInput(payload.lastPreventiveMaintenanceDate);

  if (!brand || !model || !plate || !lastPreventiveMaintenanceDate || !drivingCity) {
    throw new Error("Debes completar marca, modelo, placa, ubicacion y fecha del ultimo mantenimiento.");
  }

  if (!ALLOWED_DRIVING_CITIES.includes(drivingCity)) {
    throw new Error("Debes seleccionar una ubicacion valida.");
  }

  if (!Number.isFinite(year) || year < 1900 || year > 2100) {
    throw new Error("El año debe estar entre 1900 y 2100.");
  }

  if (!Number.isFinite(currentMileage) || currentMileage < 0) {
    throw new Error("El kilometraje actual debe ser un número mayor o igual a 0.");
  }

  if (!Number.isFinite(usualDailyKm) || usualDailyKm < 10 || usualDailyKm > 200) {
    throw new Error("Los km diarios deben estar entre 10 y 200.");
  }

  if (Number.isNaN(lastPreventiveMaintenanceDate.getTime())) {
    throw new Error("La fecha del último mantenimiento no es válida.");
  }

  return {
    brand,
    model,
    version,
    year,
    currentMileage,
    usualDailyKm,
    drivingCity,
    plate,
    lastPreventiveMaintenanceDate,
  };
}

function normalizePaginationValue(value, fallback, maxValue = 20) {
  const parsedValue = Number.parseInt(value, 10);

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.min(parsedValue, maxValue);
}

function sanitizeOrderForClient(order) {
  const serializedOrder = order?.toObject ? order.toObject() : { ...(order || {}) };

  delete serializedOrder.trackingEvents;

  if (serializedOrder.vehicle) {
    delete serializedOrder.vehicle.description;
    delete serializedOrder.vehicle.internalIdentifier;
  }

  serializedOrder.trackingSteps = normalizeTrackingStates(serializedOrder.trackingSteps || [])
    .map((step) => {
      const visibleUpdates = Array.isArray(step.updates)
        ? step.updates
            .filter((update) => update?.clientVisible)
            .map((update) => ({
              ...update,
              media: Array.isArray(update.media)
                ? update.media.filter((item) => item?.clientVisible !== false)
                : [],
            }))
        : [];

      return {
        ...step,
        clientVisible: visibleUpdates.length > 0,
        media: Array.isArray(step.media)
          ? step.media.filter((item) => item?.clientVisible !== false)
          : [],
        updates: visibleUpdates,
      };
    })
    .filter((step) => step.clientVisible && (step.confirmed || step.inProgress || step.updates.length));

  return serializedOrder;
}

function normalizeTrackingNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || "";
  const authCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("globalAppToken="));

  if (!authCookie) {
    return "";
  }

  return authCookie.slice("globalAppToken=".length);
}

function resolveRequestToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.split(" ")[1];

    if (bearerToken && bearerToken !== "null" && bearerToken !== "undefined") {
      return bearerToken;
    }
  }

  return getCookieToken(req);
}

async function resolveOptionalAuthenticatedClient(req) {
  try {
    const token = resolveRequestToken(req);

    if (!token) {
      return null;
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    if (!decodedToken?.sub) {
      return null;
    }

    const user = await User.findById(decodedToken.sub).select("_id email role isActive");

    if (!user || user.role !== "client" || user.isActive === false) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

async function resolveLinkedClientRecordsByEmail(email) {
  const normalizedEmail = String(email || "").toLowerCase().trim();

  if (!normalizedEmail) {
    return {
      latamClient: null,
      usaClient: null,
    };
  }

  const [latamClient, usaClient] = await Promise.all([
    Client.findOne({ email: normalizedEmail }).select("_id"),
    ClientGlobalUS.findOne({ email: normalizedEmail }).select("_id"),
  ]);

  return {
    latamClient,
    usaClient,
  };
}

async function getPublicTrackingOrder(req, res) {
  try {
    const trackingNumber = normalizeTrackingNumber(req.params.trackingNumber);

    if (!trackingNumber) {
      return res.status(400).json({ message: "Tracking number is required" });
    }

    const trackingQuery = {
      trackingNumber: {
        $regex: `^${escapeRegex(trackingNumber)}$`,
        $options: "i",
      },
    };

    let order = await Order.findOne(trackingQuery).populate("createdBy", "name email role");
    let orderRegion = "latam";
    let linkedClientModel = Client;

    if (!order) {
      order = await OrderGlobalUS.findOne(trackingQuery).populate("createdBy", "name email role");
      orderRegion = "usa";
      linkedClientModel = ClientGlobalUS;
    }

    if (!order) {
      return res.status(404).json({ message: "Tracking not found" });
    }

    const authenticatedClient = await resolveOptionalAuthenticatedClient(req);
    let linkedToClient = false;

    if (authenticatedClient && !order.client) {
      const linkedClient = await linkedClientModel.findOne({
        email: String(authenticatedClient.email || "").toLowerCase().trim(),
      }).select("_id");

      if (linkedClient?._id) {
        order.client = linkedClient._id;
        await order.save();
        linkedToClient = true;
      }
    }

    if (authenticatedClient?.email) {
      const normalizedSubscriberEmail = String(authenticatedClient.email).toLowerCase().trim();
      const existingSubscriberIndex = (order.trackingSubscribers || []).findIndex((subscriber) => {
        const subscriberEmail = String(subscriber?.email || "").toLowerCase().trim();
        const subscriberUserId = String(subscriber?.user || "");
        return subscriberEmail === normalizedSubscriberEmail || subscriberUserId === String(authenticatedClient._id);
      });

      if (existingSubscriberIndex >= 0) {
        order.trackingSubscribers[existingSubscriberIndex].email = normalizedSubscriberEmail;
        order.trackingSubscribers[existingSubscriberIndex].user = authenticatedClient._id;
        order.trackingSubscribers[existingSubscriberIndex].lastViewedAt = new Date();
      } else {
        order.trackingSubscribers.push({
          user: authenticatedClient._id,
          email: normalizedSubscriberEmail,
          subscribedAt: new Date(),
          lastViewedAt: new Date(),
        });
      }

      await order.save();
    }

    const hydratedOrder = await hydrateOrderTracking(order, orderRegion, {
      preferCollectionOnly: true,
    });

    return res.status(200).json({
      order: sanitizeOrderForClient(hydratedOrder),
      linkedToClient,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching tracking" });
  }
}

async function getClientDashboard(req, res) {
  try {
    await publishDueScheduledPosts();

    const { latamClient, usaClient } = await resolveLinkedClientRecordsByEmail(req.user.email);
    const linkedLatamClientId = latamClient?._id || null;
    const linkedUsaClientId = usaClient?._id || null;

    const [notificationPosts, latamOrders, usaOrders, maintenance, maintenanceVehicles] = await Promise.all([
      Post.find({ status: "published" }).populate("publishedBy", "name email role").sort({ publishedAt: -1, createdAt: -1 }).limit(4),
      Order.find(linkedLatamClientId ? { client: linkedLatamClientId } : { _id: null })
        .populate("client", "name email phone")
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 }),
      OrderGlobalUS.find(linkedUsaClientId ? { client: linkedUsaClientId } : { _id: null })
        .populate("client", "name email phone")
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 }),
      Maintenance.find(linkedLatamClientId ? { client: linkedLatamClientId } : { _id: null })
        .populate("client", "name email phone")
        .populate({
          path: "order",
          select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
        })
        .sort({ dueDate: 1 }),
      ClientMaintenanceVehicle.find({ user: req.user._id })
        .sort({ createdAt: -1 }),
    ]);

    const hydratedOrders = await hydrateOrdersTracking(
      latamOrders
        .map((order) => ({ order, orderRegion: "latam", preferCollectionOnly: true }))
        .concat(usaOrders.map((order) => ({ order, orderRegion: "usa", preferCollectionOnly: true })))
    );

    const orders = hydratedOrders.sort((left, right) => {
      const leftCreatedAt = new Date(left.createdAt || 0).getTime();
      const rightCreatedAt = new Date(right.createdAt || 0).getTime();

      return rightCreatedAt - leftCreatedAt;
    });

    const sanitizedOrders = orders.map((order) => sanitizeOrderForClient(order));
    const notifications = filterDismissedNotifications(
      buildNotifications(notificationPosts, orders, maintenance),
      req.user.dismissedNotifications
    );

    const nextBadgeCount = notifications.length;

    if ((req.user.notificationBadgeCount || 0) !== nextBadgeCount) {
      req.user.notificationBadgeCount = nextBadgeCount;
      await req.user.save();
    }

    return res.status(200).json({
      user: req.user,
      orders: sanitizedOrders,
      maintenance,
      maintenanceVehicles,
      notifications,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client dashboard" });
  }
}

async function createClientMaintenanceVehicle(req, res) {
  try {
    const normalizedVehicle = normalizeClientMaintenanceVehiclePayload(req.body);

    const linkedClient = await Client.findOne({
      email: String(req.user.email || "").toLowerCase().trim(),
    }).select("_id");

    const vehicle = await ClientMaintenanceVehicle.create({
      user: req.user._id,
      client: linkedClient?._id || null,
      brand: normalizedVehicle.brand,
      model: normalizedVehicle.model,
      version: normalizedVehicle.version || undefined,
      year: normalizedVehicle.year,
      currentMileage: normalizedVehicle.currentMileage,
      usualDailyKm: normalizedVehicle.usualDailyKm,
      drivingCity: normalizedVehicle.drivingCity,
      plate: normalizedVehicle.plate,
      lastPreventiveMaintenanceDate: normalizedVehicle.lastPreventiveMaintenanceDate,
    });

    return res.status(201).json({
      message: "Vehicle added successfully",
      vehicle,
    });
  } catch (error) {
    const statusCode = error.message?.includes("mantenimiento") || error.message?.includes("km") || error.message?.includes("año") || error.message?.includes("ubicacion")
      ? 400
      : 500;
    return res.status(statusCode).json({ message: error.message || "Error creating maintenance vehicle" });
  }
}

async function updateClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const normalizedVehicle = normalizeClientMaintenanceVehiclePayload(req.body);

    const vehicle = await ClientMaintenanceVehicle.findOne({
      _id: vehicleId,
      user: req.user._id,
    });

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    vehicle.brand = normalizedVehicle.brand;
    vehicle.model = normalizedVehicle.model;
    vehicle.version = normalizedVehicle.version || undefined;
    vehicle.year = normalizedVehicle.year;
    vehicle.currentMileage = normalizedVehicle.currentMileage;
    vehicle.usualDailyKm = normalizedVehicle.usualDailyKm;
    vehicle.drivingCity = normalizedVehicle.drivingCity;
    vehicle.plate = normalizedVehicle.plate;
    vehicle.lastPreventiveMaintenanceDate = normalizedVehicle.lastPreventiveMaintenanceDate;

    await vehicle.save();

    return res.status(200).json({
      message: "Vehicle updated successfully",
      vehicle,
    });
  } catch (error) {
    const statusCode = error.message?.includes("mantenimiento") || error.message?.includes("km") || error.message?.includes("año") || error.message?.includes("ubicacion")
      ? 400
      : 500;
    return res.status(statusCode).json({ message: error.message || "Error updating maintenance vehicle" });
  }
}

async function deleteClientMaintenanceVehicle(req, res) {
  try {
    const { vehicleId } = req.params;

    const deletedVehicle = await ClientMaintenanceVehicle.findOneAndDelete({
      _id: vehicleId,
      user: req.user._id,
    });

    if (!deletedVehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    return res.status(200).json({
      message: "Vehicle deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting maintenance vehicle" });
  }
}

async function dismissClientNotification(req, res) {
  try {
    const notificationId = String(req.params.notificationId || "").trim();

    if (!notificationId) {
      return res.status(400).json({ message: "Notification id is required" });
    }

    if (!Array.isArray(req.user.dismissedNotifications)) {
      req.user.dismissedNotifications = [];
    }

    if (!req.user.dismissedNotifications.includes(notificationId)) {
      req.user.dismissedNotifications.push(notificationId);
      req.user.notificationBadgeCount = Math.max(0, Number(req.user.notificationBadgeCount || 0) - 1);
      await req.user.save();
    }

    return res.status(200).json({
      message: "Notification dismissed successfully",
      dismissedNotifications: req.user.dismissedNotifications,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error dismissing notification" });
  }
}

async function registerClientPushDevice(req, res) {
  try {
    const token = String(req.body.token || "").trim();
    const platform = String(req.body.platform || "").trim().toLowerCase();
    const provider = String(req.body.provider || "").trim().toLowerCase();
    const appVersion = req.body.appVersion ? String(req.body.appVersion).trim() : undefined;

    if (!token || !platform || !provider) {
      return res.status(400).json({ message: "token, platform and provider are required" });
    }

    if (!["ios", "android"].includes(platform)) {
      return res.status(400).json({ message: "Unsupported platform" });
    }

    if (!["apns", "fcm"].includes(provider)) {
      return res.status(400).json({ message: "Unsupported provider" });
    }

    await User.updateMany(
      { "pushDevices.token": token, _id: { $ne: req.user._id } },
      {
        $pull: {
          pushDevices: { token },
        },
      }
    );

    const nextDevices = Array.isArray(req.user.pushDevices) ? [...req.user.pushDevices] : [];
    const existingDeviceIndex = nextDevices.findIndex((item) => item.token === token);
    const nextDevice = {
      token,
      platform,
      provider,
      appVersion,
      lastRegisteredAt: new Date(),
    };

    if (existingDeviceIndex >= 0) {
      nextDevices[existingDeviceIndex] = nextDevice;
    } else {
      nextDevices.push(nextDevice);
    }

    req.user.pushDevices = nextDevices;
    await req.user.save();

    return res.status(200).json({
      message: "Push device registered successfully",
      pushDevices: req.user.pushDevices,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error registering push device" });
  }
}

async function listClientPosts(req, res) {
  try {
    await publishDueScheduledPosts();

    const offset = normalizePaginationValue(req.query.offset, 0, 1000);
    const limit = normalizePaginationValue(req.query.limit, 5, 10);

    const posts = await Post.find({ status: "published" })
      .populate("publishedBy", "name email role")
      .sort({ publishedAt: -1, createdAt: -1 })
      .skip(offset)
      .limit(limit + 1);

    const hasMore = posts.length > limit;

    return res.status(200).json({
      posts: hasMore ? posts.slice(0, limit) : posts,
      pagination: {
        offset,
        limit,
        nextOffset: offset + limit,
        hasMore,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client posts" });
  }
}

async function listClientVirtualDealershipVehicles(req, res) {
  try {
    const vehicles = await VirtualShowcaseVehicle.find({
      isPublished: true,
      status: { $in: ["available", "reserved"] },
    })
      .populate("listedBy", "name email role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ vehicles });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching virtual dealership vehicles" });
  }
}

async function createAuthenticatedClientRequest(req, res) {
  try {
    const { customerPhone, vehicle, reservationAmount, currency, notes } = req.body;

    if (!customerPhone || !vehicle || !vehicle.brand || !vehicle.model || reservationAmount == null) {
      return res.status(400).json({
        message: "customerPhone, vehicle and reservationAmount are required",
      });
    }

    const clientRequest = await ClientRequest.create({
      client: req.user._id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: String(customerPhone).trim(),
      vehicle: {
        brand: String(vehicle.brand).trim(),
        model: String(vehicle.model).trim(),
        color: vehicle.color ? String(vehicle.color).trim() : undefined,
        upholstery: vehicle.upholstery ? String(vehicle.upholstery).trim() : undefined,
        version: vehicle.version ? String(vehicle.version).trim() : undefined,
        year: vehicle.year ? Number(vehicle.year) : undefined,
      },
      reservationAmount: Number(reservationAmount),
      currency: currency ? String(currency).trim().toUpperCase() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      source: "client-portal-authenticated",
    });

    return res.status(201).json({
      message: "Client request created successfully",
      clientRequest,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error creating client request" });
  }
}

async function updateClientMaintenance(req, res) {
  try {
    const { maintenanceId } = req.params;
    const { reportedMileage, lastServiceDate, clientNotes } = req.body;
    const maintenance = await Maintenance.findById(maintenanceId)
      .populate("client", "name email phone")
      .populate({
        path: "order",
        select: "trackingNumber vehicle purchaseDate expectedArrivalDate status trackingSteps",
      });

    if (!maintenance) {
      return res.status(404).json({ message: "Maintenance not found" });
    }

    const linkedClient = await Client.findOne({
      email: String(req.user.email || "").toLowerCase().trim(),
    }).select("_id");

    if (String(maintenance.client?._id || maintenance.client) !== String(linkedClient?._id || "")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (reportedMileage != null && reportedMileage !== "") {
      maintenance.reportedMileage = Number(reportedMileage);
    }

    if (lastServiceDate) {
      maintenance.lastServiceDate = lastServiceDate;
    }

    if (typeof clientNotes === "string") {
      maintenance.clientNotes = clientNotes.trim();
    }

    maintenance.lastClientUpdateAt = new Date();

    await maintenance.save();

    return res.status(200).json({
      message: "Maintenance report updated successfully",
      maintenance,
    });
  } catch (error) {
    return res.status(500).json({ message: "Error updating client maintenance" });
  }
}

async function createDocuSignPreagreementSigningUrl(req, res) {
  try {
    const payload = req.body || {};
    const config = getRequiredDocuSignConfig();
    const accessToken = await getDocuSignAccessToken(config);
    const accountData = await resolveDocuSignAccountData(accessToken, config.accountId);
    const apiBaseUrl = getDocuSignApiBaseUrl(accountData.baseUri);
    const contractHtml = buildPreagreementHtml(payload);
    const documentBase64 = Buffer.from(contractHtml, "utf8").toString("base64");
    const signerName = String(req.user?.name || "Cliente").trim() || "Cliente";
    const signerEmail = String(req.user?.email || "").trim().toLowerCase();

    if (!signerEmail) {
      return res.status(400).json({ message: "No encontramos un correo válido para firmar el contrato." });
    }

    const clientUserId = String(req.user?._id || "");

    const envelopeDefinition = {
      emailSubject: "Preacuerdo de compra - Global Imports",
      status: "sent",
      documents: [
        {
          documentBase64,
          name: "Preacuerdo Global Imports",
          fileExtension: "html",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: "1",
            routingOrder: "1",
            clientUserId,
            tabs: {
              textTabs: [
                { anchorString: "/full_name/", required: "true", locked: "false", tabLabel: "full_name" },
                { anchorString: "/doc_type/", required: "true", locked: "false", tabLabel: "doc_type" },
                { anchorString: "/doc_number/", required: "true", locked: "false", tabLabel: "doc_number" },
              ],
              dateSignedTabs: [
                { anchorString: "/sign_date/", required: "true", tabLabel: "sign_date" },
              ],
              signHereTabs: [
                { anchorString: "/sign_here/", tabLabel: "sign_here" },
              ],
            },
          },
        ],
      },
    };

    const createEnvelopeResponse = await fetch(`${apiBaseUrl}/v2.1/accounts/${accountData.accountId}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelopeDefinition),
    });

    const envelopeData = await createEnvelopeResponse.json();

    if (!createEnvelopeResponse.ok || !envelopeData?.envelopeId) {
      return res.status(502).json({
        message: envelopeData?.message || "No se pudo crear el contrato en DocuSign.",
      });
    }

    const baseClientUrl = config.returnUrl
      ? config.returnUrl.replace(/\?.*$/, "")
      : `${req.protocol}://${req.get("host")}/app/client.html`;
    const returnUrlObj = new URL(baseClientUrl);
    returnUrlObj.searchParams.set("view", "pago-separacion");
    const v = payload.vehicle || {};
    if (v.brand) returnUrlObj.searchParams.set("brand", v.brand);
    if (v.model) returnUrlObj.searchParams.set("model", v.model);
    if (v.version) returnUrlObj.searchParams.set("version", v.version);
    if (v.exteriorColor) returnUrlObj.searchParams.set("extColor", v.exteriorColor);
    if (v.interiorColor) returnUrlObj.searchParams.set("intColor", v.interiorColor);
    if (payload.deliveryCity) returnUrlObj.searchParams.set("city", payload.deliveryCity);
    if (payload.totalPriceLabel) returnUrlObj.searchParams.set("price", payload.totalPriceLabel);
    const returnUrl = returnUrlObj.toString();

    const viewRequest = {
      returnUrl,
      authenticationMethod: "none",
      email: signerEmail,
      userName: signerName,
      clientUserId,
      recipientId: "1",
    };

    const createViewResponse = await fetch(
      `${apiBaseUrl}/v2.1/accounts/${accountData.accountId}/envelopes/${envelopeData.envelopeId}/views/recipient`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(viewRequest),
      }
    );

    const viewData = await createViewResponse.json();

    if (!createViewResponse.ok || !viewData?.url) {
      return res.status(502).json({
        message: viewData?.message || "No se pudo generar el enlace de firma en DocuSign.",
      });
    }

    return res.status(200).json({
      signingUrl: viewData.url,
      envelopeId: envelopeData.envelopeId,
    });
  } catch (error) {
    if (error.code === "consent_required") {
      return res.status(412).json({
        message: error.message,
        code: error.code,
        consentUrl: error.consentUrl || "",
      });
    }

    return res.status(500).json({ message: error.message || "Error iniciando firma DocuSign" });
  }
}

function getWompiConfig(req, res) {
  const publicKey = String(process.env.WOMPI_PUBLIC_KEY || "").trim();
  if (!publicKey) {
    return res.status(503).json({ message: "Pasarela de pago no configurada." });
  }
  return res.json({
    publicKey,
    amountInCents: 100000000,
    currency: "COP",
  });
}

function getWompiApiBaseUrl() {
  const key = String(process.env.WOMPI_PUBLIC_KEY || process.env.WOMPI_PRIVATE_KEY || "").trim();
  return key.startsWith("pub_test_") || key.startsWith("prv_test_")
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";
}

async function generateUniqueTrackingNumber() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = `GI-${Math.floor(100000 + Math.random() * 90000000)}`;
    const exists = await Order.findOne({
      trackingNumber: {
        $regex: `^${escapeRegex(candidate)}$`,
        $options: "i",
      },
    }).select("_id");

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("No fue posible generar un tracking único.");
}

async function resolveOrCreateLinkedClient(user) {
  const normalizedEmail = String(user?.email || "").toLowerCase().trim();

  if (!normalizedEmail) {
    return null;
  }

  const existingClient = await Client.findOne({ email: normalizedEmail });

  if (existingClient) {
    return existingClient;
  }

  return Client.create({
    name: String(user?.name || "Cliente").trim() || "Cliente",
    email: normalizedEmail,
    phone: String(user?.phone || "").trim() || undefined,
    identification: String(user?.identification || "").trim() || undefined,
    address: String(user?.address || "").trim() || undefined,
    city: String(user?.city || "").trim() || undefined,
    country: String(user?.country || "").trim() || undefined,
    createdBy: user?._id || null,
  });
}

async function confirmWompiPaymentAndCreateOrder(req, res) {
  try {
    const privateKey = String(process.env.WOMPI_PRIVATE_KEY || "").trim();

    if (!privateKey) {
      return res.status(503).json({ message: "Wompi no está configurado (falta WOMPI_PRIVATE_KEY)." });
    }

    const payload = req.body || {};
    const transactionId = String(
      payload.transactionId || payload.id || payload.transaction_id || ""
    ).trim();
    const fallbackStatus = String(payload.status || "").trim().toUpperCase();
    const reference = String(payload.reference || "").trim();
    const vehiclePayload = payload.vehicle || {};

    if (!transactionId) {
      return res.status(400).json({ message: "transactionId es requerido." });
    }

    const wompiResponse = await fetch(`${getWompiApiBaseUrl()}/transactions/${encodeURIComponent(transactionId)}`, {
      headers: {
        Authorization: `Bearer ${privateKey}`,
      },
    });

    const wompiJson = await wompiResponse.json().catch(() => ({}));
    const transaction = wompiJson?.data || {};
    const transactionStatus = String(transaction?.status || fallbackStatus || "").toUpperCase();
    const approved = transactionStatus === "APPROVED";

    if (!approved) {
      return res.status(200).json({
        paid: false,
        status: transactionStatus || "UNKNOWN",
        message: "El pago aún no está aprobado por Wompi.",
      });
    }

    const existingOrder = await Order.findOne({
      notes: {
        $regex: `WOMPI_TX:${escapeRegex(transactionId)}`,
        $options: "i",
      },
    }).select("_id trackingNumber");

    if (existingOrder) {
      return res.status(200).json({
        paid: true,
        orderCreated: true,
        alreadyProcessed: true,
        trackingNumber: existingOrder.trackingNumber,
      });
    }

    const linkedClient = await resolveOrCreateLinkedClient(req.user);

    if (!linkedClient?._id) {
      return res.status(400).json({ message: "No se pudo asociar el pago a un cliente válido." });
    }

    const trackingNumber = await generateUniqueTrackingNumber();
    const brand = String(vehiclePayload.brand || payload.brand || "Toyota").trim() || "Toyota";
    const model = String(vehiclePayload.model || payload.model || "Sequoia").trim() || "Sequoia";
    const version = String(vehiclePayload.version || payload.version || "Por definir").trim() || "Por definir";
    const exteriorColor = String(vehiclePayload.exteriorColor || payload.extColor || "Por definir").trim() || "Por definir";
    const interiorColor = String(vehiclePayload.interiorColor || payload.intColor || "Por definir").trim() || "Por definir";
    const year = Number.parseInt(String(vehiclePayload.year || payload.year || new Date().getFullYear()), 10) || new Date().getFullYear();

    const order = await Order.create({
      client: linkedClient._id,
      createdBy: req.user._id,
      trackingNumber,
      vehicle: {
        brand,
        model,
        version,
        year,
        color: exteriorColor,
        exteriorColor,
        interiorColor,
        destination: "Puerto Cartagena",
        internalIdentifier: String(reference || transaction?.reference || "WOMPI").trim() || undefined,
      },
      purchaseDate: new Date(),
      notes: [
        "Orden creada automaticamente por pago Wompi aprobado.",
        `WOMPI_TX:${transactionId}`,
        `WOMPI_REF:${String(transaction?.reference || reference || "N/A")}`,
        `WOMPI_STATUS:${transactionStatus}`,
        `WOMPI_AMOUNT_CENTS:${String(transaction?.amount_in_cents || "N/A")}`,
      ].join(" | "),
    });

    return res.status(200).json({
      paid: true,
      orderCreated: true,
      trackingNumber: order.trackingNumber,
      orderId: order._id,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error confirmando pago Wompi." });
  }
}

module.exports = {
  wompiWebhookHandler,
  confirmWompiPaymentAndCreateOrder,
  getWompiConfig,
  createDocuSignPreagreementSigningUrl,
  createAuthenticatedClientRequest,
  dismissClientNotification,
  createClientMaintenanceVehicle,
  updateClientMaintenanceVehicle,
  deleteClientMaintenanceVehicle,
  getClientDashboard,
  getPublicTrackingOrder,
  listClientPosts,
  listClientVirtualDealershipVehicles,
  registerClientPushDevice,
  updateClientMaintenance,
};