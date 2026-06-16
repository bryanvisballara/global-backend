(() => {
if (window.__adminOrderAccountingScriptInitialized) {
  return;
}

window.__adminOrderAccountingScriptInitialized = true;

const {
  attachLogout,
  fetchJson,
  formatCurrency,
  formatDateTimeInBogota,
  loadAdminSession,
  requireAdminAccess,
  resetLoadingOverlay,
  setFeedback,
} = window.AdminApp;

const EXPENSE_CONCEPTS = [
  { value: "port-expense", label: "Gasto de Puerto" },
  { value: "taxes", label: "Impuestos" },
  { value: "nationalization", label: "Nacionalización" },
  { value: "transport", label: "Transporte" },
  { value: "fees", label: "Honorarios" },
  { value: "vehicle-payment", label: "Pago Vehículo" },
  { value: "other", label: "Otros" },
];

if (!requireAdminAccess()) {
  return;
}

attachLogout();

const orderId = new URLSearchParams(window.location.search).get("orderId") || "";
const backLink = document.getElementById("accounting-back-link");
const orderCard = document.getElementById("accounting-order-card");
const purchasePriceElement = document.getElementById("accounting-purchase-price");
const salePriceElement = document.getElementById("accounting-sale-price");
const otherExpensesElement = document.getElementById("accounting-other-expenses");
const vehiclePaymentElement = document.getElementById("accounting-vehicle-payment");
const vehicleBalanceElement = document.getElementById("accounting-vehicle-balance");
const profitElement = document.getElementById("accounting-profit");
const expenseForm = document.getElementById("accounting-expense-form");
const conceptSelect = document.getElementById("accounting-concept");
const submitButton = document.getElementById("accounting-submit-button");
const formFeedback = document.getElementById("accounting-form-feedback");
const historyBody = document.getElementById("accounting-history-body");
const historyFeedback = document.getElementById("accounting-history-feedback");

let currentOrder = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "").trim();
}

function formatMoney(value) {
  return formatCurrency(Number(value || 0), "COP");
}

function populateConcepts() {
  conceptSelect.innerHTML = [
    '<option value="">Selecciona</option>',
    ...EXPENSE_CONCEPTS.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`),
  ].join("");
}

function getConceptLabel(value) {
  return EXPENSE_CONCEPTS.find((item) => item.value === value)?.label || "Otros";
}

function getExpenses(order) {
  return Array.isArray(order?.expenses) ? order.expenses : [];
}

function getVehiclePaymentTotal(expenses) {
  return expenses
    .filter((expense) => normalizeText(expense?.concept) === "vehicle-payment")
    .reduce((total, expense) => total + Number(expense?.value || 0), 0);
}

function getOtherExpensesTotal(expenses) {
  return expenses
    .filter((expense) => normalizeText(expense?.concept) !== "vehicle-payment")
    .reduce((total, expense) => total + Number(expense?.value || 0), 0);
}

function renderOrderCard(order) {
  if (!order) {
    orderCard.innerHTML = '<div class="empty-state">No se encontró el pedido.</div>';
    return;
  }

  orderCard.innerHTML = `
    <div class="accounting-order-copy">
      <h2>${escapeHtml(`${order?.vehicle?.brand || "Vehículo"} ${order?.vehicle?.model || ""}${order?.vehicle?.version ? ` ${order.vehicle.version}` : ""} ${order?.vehicle?.year || ""}`.trim())}</h2>
      <p><strong>Tracking:</strong> ${escapeHtml(order?.trackingNumber || "-")}</p>
      <p><strong>VIN:</strong> ${escapeHtml(order?.vehicle?.vin || "-")}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(order?.client?.name || "Cliente sin asignar")}</p>
      <p><strong>Email cliente:</strong> ${escapeHtml(order?.client?.email || "-")}</p>
      <p><strong>Teléfono:</strong> ${escapeHtml(order?.client?.phone || "-")}</p>
    </div>
  `;
}

function renderSummary(order) {
  const expenses = getExpenses(order);
  const purchasePrice = Number(order?.vehicle?.purchasePrice || 0);
  const salePrice = Number(order?.vehicle?.salePrice || 0);
  const vehiclePayment = getVehiclePaymentTotal(expenses);
  const otherExpenses = getOtherExpensesTotal(expenses);
  const vehicleBalance = purchasePrice - vehiclePayment;
  const profit = salePrice - purchasePrice - otherExpenses;

  purchasePriceElement.textContent = formatMoney(purchasePrice);
  salePriceElement.textContent = formatMoney(salePrice);
  otherExpensesElement.textContent = formatMoney(otherExpenses);
  vehiclePaymentElement.textContent = formatMoney(vehiclePayment);
  vehicleBalanceElement.textContent = formatMoney(vehicleBalance);
  profitElement.textContent = formatMoney(profit);
}

function renderHistory(order) {
  const expenses = getExpenses(order)
    .slice()
    .sort((left, right) => new Date(right?.createdAt || 0).getTime() - new Date(left?.createdAt || 0).getTime());

  if (!expenses.length) {
    historyBody.innerHTML = '<tr><td class="accounting-history-empty" colspan="6">No hay gastos registrados.</td></tr>';
    return;
  }

  historyBody.innerHTML = expenses.map((expense) => {
    const evidenceUrl = normalizeText(expense?.evidence?.url);
    const evidenceLabel = expense?.evidence?.type === "image" ? "Ver imagen" : "Ver archivo";

    return `
      <tr>
        <td>${escapeHtml(getConceptLabel(normalizeText(expense?.concept)))}</td>
        <td>${escapeHtml(expense?.description || "-")}</td>
        <td>${escapeHtml(formatMoney(expense?.value || 0))}</td>
        <td>
          ${evidenceUrl ? `<a class="accounting-evidence-link" href="${escapeHtml(evidenceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(evidenceLabel)}</a>` : "Sin evidencia"}
        </td>
        <td>${escapeHtml(formatDateTimeInBogota(expense?.createdAt || expense?.updatedAt || null))}</td>
        <td>
          <button class="secondary-button accounting-delete-button" type="button" data-delete-expense-id="${escapeHtml(expense?.expenseId || "")}">Eliminar</button>
        </td>
      </tr>
    `;
  }).join("");
}

function renderPage(order) {
  currentOrder = order;
  renderOrderCard(order);
  renderSummary(order);
  renderHistory(order);

  const isLatamOrder = normalizeText(order?.orderRegion || "latam") === "latam";
  expenseForm.hidden = !isLatamOrder;
  submitButton.disabled = !isLatamOrder;

  if (!isLatamOrder) {
    setFeedback(formFeedback, "La contabilidad solo está disponible para pedidos LATAM.", "error");
  } else {
    setFeedback(formFeedback, "");
  }
}

async function loadOrder() {
  if (!orderId) {
    throw new Error("Falta el orderId del pedido.");
  }

  const response = await fetchJson(`/api/admin/orders/${encodeURIComponent(orderId)}`);
  return response.order || null;
}

async function refreshPage() {
  const order = await loadOrder();
  renderPage(order);
  return order;
}

async function handleExpenseSubmit(event) {
  event.preventDefault();

  if (!currentOrder || normalizeText(currentOrder?.orderRegion) !== "latam") {
    return;
  }

  const formData = new FormData(expenseForm);

  submitButton.disabled = true;
  setFeedback(formFeedback, "");

  try {
    const response = await fetchJson(`/api/admin/orders/${encodeURIComponent(orderId)}/accounting-expenses`, {
      method: "POST",
      body: formData,
      loadingMessage: "Guardando gasto...",
    });

    expenseForm.reset();
    currentOrder = response.order || currentOrder;
    renderPage(currentOrder);
    setFeedback(formFeedback, "Gasto registrado correctamente.", "success");
  } catch (error) {
    setFeedback(formFeedback, error.message || "No se pudo registrar el gasto.", "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function handleExpenseDelete(expenseId) {
  if (!expenseId || !window.confirm("¿Deseas eliminar este gasto?")) {
    return;
  }

  setFeedback(historyFeedback, "");

  try {
    const response = await fetchJson(`/api/admin/orders/${encodeURIComponent(orderId)}/accounting-expenses/${encodeURIComponent(expenseId)}`, {
      method: "DELETE",
      loadingMessage: "Eliminando gasto...",
    });

    currentOrder = response.order || currentOrder;
    renderPage(currentOrder);
    setFeedback(historyFeedback, "Gasto eliminado correctamente.", "success");
  } catch (error) {
    setFeedback(historyFeedback, error.message || "No se pudo eliminar el gasto.", "error");
  }
}

historyBody?.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-delete-expense-id]");

  if (!deleteButton) {
    return;
  }

  handleExpenseDelete(String(deleteButton.dataset.deleteExpenseId || ""));
});

expenseForm?.addEventListener("submit", handleExpenseSubmit);

if (backLink && orderId) {
  backLink.href = `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}`;
}

populateConcepts();

(async () => {
  try {
    await loadAdminSession();
    await refreshPage();
  } catch (error) {
    orderCard.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "No se pudo cargar la contabilidad del pedido.")}</div>`;
    historyBody.innerHTML = '<tr><td class="accounting-history-empty" colspan="6">No fue posible cargar los gastos.</td></tr>';
    setFeedback(formFeedback, error.message || "No se pudo cargar el pedido.", "error");
  } finally {
    resetLoadingOverlay();
  }
})();
})();