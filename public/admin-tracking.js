const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  parseMediaUrls,
  populateSelect,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
  trackingTemplates,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const trackingForm = document.getElementById("tracking-form");
  const trackingFeedback = document.getElementById("tracking-feedback");
  const trackingOrderSelect = document.getElementById("tracking-order-id");
  const trackingStepSelect = document.getElementById("tracking-step-key");
  const trackingPreview = document.getElementById("tracking-preview");
  let orders = [];

  function populateTrackingSteps() {
    const selectedOrder = orders.find((order) => order._id === trackingOrderSelect.value) || orders[0];
    const steps = selectedOrder ? selectedOrder.trackingSteps : trackingTemplates;
    populateSelect(trackingStepSelect, steps, "Selecciona un paso", "key", (step) => step.label);
  }

  function renderTrackingPreview() {
    const selectedOrder = orders.find((order) => order._id === trackingOrderSelect.value) || orders[0];

    if (!selectedOrder) {
      renderEmptyState(trackingPreview, "Todavía no hay pedidos para seguimiento.");
      return;
    }

    trackingPreview.innerHTML = `
      <div class="tracking-card-header">
        <strong>${selectedOrder.vehicle.brand} ${selectedOrder.vehicle.model} ${selectedOrder.vehicle.year}</strong>
        <p>${selectedOrder.client?.name || "Cliente"} · Tracking ${selectedOrder.trackingNumber}</p>
      </div>
      <div class="tracking-steps-list">
        ${selectedOrder.trackingSteps.map((step) => `
          <article class="tracking-step ${step.status}">
            <div>
              <strong>${step.label}</strong>
              <p>${step.notes || "Sin notas para este paso."}</p>
            </div>
            <span>${step.status}</span>
          </article>
        `).join("")}
      </div>
    `;
  }

  async function loadTrackingPage() {
    await loadAdminSession();
    const ordersData = await fetchJson("/api/admin/orders");
    orders = ordersData.orders || [];
    populateSelect(trackingOrderSelect, orders, "Selecciona un pedido", "_id", (order) => `${order.trackingNumber} · ${order.vehicle.brand} ${order.vehicle.model}`);
    populateTrackingSteps();
    renderTrackingPreview();
  }

  trackingOrderSelect.addEventListener("change", () => {
    populateTrackingSteps();
    renderTrackingPreview();
  });

  trackingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(trackingForm);

    setFeedback(trackingFeedback, "Actualizando seguimiento...");

    try {
      await fetchJson(`/api/admin/orders/${formData.get("orderId")}/tracking-steps/${formData.get("stepKey")}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: formData.get("status"),
          notes: formData.get("notes"),
          media: parseMediaUrls(formData.get("mediaUrls")),
        }),
      });

      trackingForm.reset();
      setFeedback(trackingFeedback, "Seguimiento actualizado correctamente.", "success");
      await loadTrackingPage();
    } catch (error) {
      setFeedback(trackingFeedback, error.message, "error");
    }
  });

  loadTrackingPage().catch((error) => {
    renderEmptyState(trackingPreview, error.message);
  });
}