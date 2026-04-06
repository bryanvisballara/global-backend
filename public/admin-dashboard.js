const { fetchJson, loadAdminSession, requireAdminAccess, attachLogout } = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  async function loadDashboard() {
    try {
      await loadAdminSession();

      const [usersData, requestsData, ordersData, maintenanceData, postsData] = await Promise.all([
        fetchJson("/api/admin/users"),
        fetchJson("/api/admin/client-requests"),
        fetchJson("/api/admin/orders"),
        fetchJson("/api/admin/maintenance"),
        fetchJson("/api/admin/posts"),
      ]);

      const clients = (usersData.users || []).filter((user) => user.role === "client");
      document.getElementById("clients-count").textContent = String(clients.length);
      document.getElementById("requests-count").textContent = String((requestsData.clientRequests || []).length);
      document.getElementById("orders-count").textContent = String((ordersData.orders || []).length);
      document.getElementById("maintenance-count").textContent = String((maintenanceData.maintenance || []).length);
      document.getElementById("posts-count").textContent = String((postsData.posts || []).length);
    } catch (error) {
      const heroFeedback = document.getElementById("dashboard-feedback");

      if (heroFeedback) {
        heroFeedback.textContent = error.message;
        heroFeedback.className = "feedback error";
      }
    }
  }

  loadDashboard();
}