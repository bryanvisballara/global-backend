const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const clientForm = document.getElementById("client-form");
  const clientFeedback = document.getElementById("client-feedback");
  const clientsList = document.getElementById("clients-list");
  const clientsCount = document.getElementById("clients-count");

  function renderClients(clients) {
    clientsCount.textContent = String(clients.length);

    if (!clients.length) {
      renderEmptyState(clientsList, "Todavía no hay clientes creados.");
      return;
    }

    clientsList.innerHTML = clients.map((client) => `
      <article class="list-item">
        <div>
          <strong>${client.name}</strong>
          <p>${client.email}${client.phone ? ` · ${client.phone}` : ""}</p>
        </div>
        <span>${client.role}</span>
      </article>
    `).join("");
  }

  async function loadClients() {
    await loadAdminSession();
    const usersData = await fetchJson("/api/admin/users");
    const clients = (usersData.users || []).filter((user) => user.role === "client");
    renderClients(clients);
  }

  clientForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(clientForm);

    setFeedback(clientFeedback, "Creando cliente...");

    try {
      await fetchJson("/api/admin/users/clients", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          password: formData.get("password"),
        }),
      });

      clientForm.reset();
      setFeedback(clientFeedback, "Cliente creado correctamente.", "success");
      await loadClients();
    } catch (error) {
      setFeedback(clientFeedback, error.message, "error");
    }
  });

  loadClients().catch((error) => {
    renderEmptyState(clientsList, error.message);
  });
}