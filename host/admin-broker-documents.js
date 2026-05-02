(() => {
const {
  attachLogout: adminAttachLogout,
  fetchJson: adminFetchJson,
  loadAdminSession,
  renderEmptyState: adminRenderEmptyState,
  setFeedback: adminSetFeedback,
} = window.AdminApp;

const summaryRoot = document.getElementById("broker-documents-summary");
const feedbackElement = document.getElementById("broker-documents-feedback");
const photosRoot = document.getElementById("broker-documents-photos");
const privateRoot = document.getElementById("broker-documents-private");

const DOCUMENT_TYPE_LABELS = new Map([
  ["FOTOS", "FOTOS DEL VEHICULO"],
  ["TITULO", "TITULO"],
  ["BUYERS_ORDER", "BUYERS ORDER"],
  ["WIRE_INSTRUCTIONS", "WIRE INSTRUCTIONS"],
  ["BOOKING", "BOOKING"],
  ["TRACKING", "TRACKING"],
  ["FACTURA", "FACTURA"],
  ["OTRO", "OTRO"],
]);

function normalizeText(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTimeLabel(value) {
  const date = new Date(value || "");

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getOrderIdFromUrl() {
  return normalizeText(new URL(window.location.href).searchParams.get("orderId") || "");
}

function getDocumentTypeLabel(value) {
  const normalizedValue = normalizeText(value || "OTRO").toUpperCase();
  return DOCUMENT_TYPE_LABELS.get(normalizedValue) || normalizedValue || "OTRO";
}

function getOrderDocuments(order) {
  return (Array.isArray(order?.media) ? order.media : [])
    .filter((item) => item?.url && (item?.category === "document" || item?.type === "document"))
    .map((item) => ({
      type: normalizeText(item.documentType || "OTRO").toUpperCase(),
      typeLabel: getDocumentTypeLabel(item.documentType || "OTRO"),
      name: normalizeText(item.name || item.caption || "Documento sin nombre") || "Documento sin nombre",
      note: normalizeText(item.note || ""),
      url: String(item.url || ""),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null,
    }))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime());
}

function renderDocumentsTable(documents = [], emptyMessage = "No hay documentos cargados.") {
  if (!documents.length) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="tracking-table-wrap">
      <table class="tracking-data-table admin-tracking-documents-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Archivo</th>
            <th>Nota</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${documents.map((document) => `
            <tr>
              <td data-label="Tipo">${escapeHtml(document.typeLabel)}</td>
              <td data-label="Archivo"><a class="tracking-document-link" href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.name)}</a></td>
              <td data-label="Nota">${escapeHtml(document.note || "-")}</td>
              <td data-label="Fecha">${escapeHtml(formatDateTimeLabel(document.updatedAt || document.createdAt))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOrderSummary(order) {
  if (!summaryRoot) {
    return;
  }

  summaryRoot.innerHTML = `
    <strong>${escapeHtml(`${order?.vehicle?.brand || "Vehiculo"} ${order?.vehicle?.model || ""} ${order?.vehicle?.version || ""} ${order?.vehicle?.year || ""}`.trim())}</strong>
    <p>Pedido ${escapeHtml(order?.trackingNumber || "-")} · Cliente ${escapeHtml(order?.client?.name || "Sin cliente")}</p>
    <p>VIN ${escapeHtml(order?.vehicle?.vin || "Sin VIN")} · Exterior ${escapeHtml(order?.vehicle?.exteriorColor || order?.vehicle?.color || "-")} · Interior ${escapeHtml(order?.vehicle?.interiorColor || "-")}</p>
  `;
}

async function loadDocumentsPage() {
  const orderId = getOrderIdFromUrl();

  if (!orderId) {
    throw new Error("No se encontro el pedido que quieres revisar.");
  }

  await loadAdminSession();
  const response = await adminFetchJson(`/api/admin/orders/${encodeURIComponent(orderId)}`);
  const order = response?.order;

  if (!order) {
    throw new Error("No se encontro el pedido.");
  }

  renderOrderSummary(order);

  const documents = getOrderDocuments(order);
  const photos = documents.filter((document) => document.type === "FOTOS");
  const privateDocuments = documents.filter((document) => document.type !== "FOTOS");

  photosRoot.innerHTML = renderDocumentsTable(photos, "No hay fotos del vehiculo cargadas.");
  privateRoot.innerHTML = renderDocumentsTable(privateDocuments, "No hay documentos privados USA.");
  adminSetFeedback(feedbackElement, "");
}

adminAttachLogout();

loadDocumentsPage().catch((error) => {
  adminSetFeedback(feedbackElement, error.message || "No se pudo cargar el pedido.", "error");
  adminRenderEmptyState(photosRoot, error.message || "No se pudo cargar el pedido.");
  adminRenderEmptyState(privateRoot, error.message || "No se pudo cargar el pedido.");
});
})();