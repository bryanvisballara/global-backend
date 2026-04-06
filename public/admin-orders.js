const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  parseMediaUrls,
  populateSelect,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const orderForm = document.getElementById("order-form");
  const orderFeedback = document.getElementById("order-feedback");
  const ordersList = document.getElementById("orders-list");
  const orderClientSelect = document.getElementById("order-client-id");
  const ordersCount = document.getElementById("orders-count");
  let clients = [];

  function renderOrders(orders) {
    ordersCount.textContent = String(orders.length);

    if (!orders.length) {
      renderEmptyState(ordersList, "Todavía no hay pedidos creados.");
      return;
    }

    ordersList.innerHTML = orders.map((order) => `
      <article class="list-item">
        <div>
          <strong>${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}</strong>
          <p>${order.client?.name || "Cliente"} · Tracking ${order.trackingNumber}</p>
        </div>
        <span>${order.status}</span>
      </article>
    `).join("");
  }

  async function loadOrdersPage() {
    await loadAdminSession();
    const [usersData, ordersData] = await Promise.all([
      fetchJson("/api/admin/users"),
      fetchJson("/api/admin/orders"),
    ]);

    clients = (usersData.users || []).filter((user) => user.role === "client");
    populateSelect(orderClientSelect, clients, "Selecciona un cliente", "_id", (client) => `${client.name} · ${client.email}`);
    renderOrders(ordersData.orders || []);
  }

  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(orderForm);

    setFeedback(orderFeedback, "Creando pedido...");

    try {
      await fetchJson("/api/admin/orders", {
        method: "POST",
        body: JSON.stringify({
          clientId: formData.get("clientId"),
          trackingNumber: formData.get("trackingNumber"),
          purchaseDate: formData.get("purchaseDate"),
          expectedArrivalDate: formData.get("expectedArrivalDate") || undefined,
          notes: formData.get("notes"),
          media: parseMediaUrls(formData.get("mediaUrls")),
          vehicle: {
            brand: formData.get("brand"),
            model: formData.get("model"),
            year: Number(formData.get("year")),
            vin: formData.get("vin"),
            color: formData.get("color"),
            description: formData.get("description"),
          },
        }),
      });

      orderForm.reset();
      populateSelect(orderClientSelect, clients, "Selecciona un cliente", "_id", (client) => `${client.name} · ${client.email}`);
      setFeedback(orderFeedback, "Pedido creado correctamente.", "success");
      await loadOrdersPage();
    } catch (error) {
      setFeedback(orderFeedback, error.message, "error");
    }
  });

  loadOrdersPage().catch((error) => {
    renderEmptyState(ordersList, error.message);
  });
}