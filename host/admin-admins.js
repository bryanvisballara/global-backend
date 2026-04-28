(() => {
  if (window.__adminAdminsScriptInitialized) {
    return;
  }

  window.__adminAdminsScriptInitialized = true;

  const {
    attachLogout,
    canCreateAdministrativeUsers,
    fetchJson,
    loadAdminSession,
    requireAdminAccess,
    setFeedback,
  } = window.AdminApp;

  if (!requireAdminAccess()) {
    return;
  }

  attachLogout();

  const createForm = document.getElementById("admin-create-form");
  const createCard = document.getElementById("admin-create-card");
  const managerWarning = document.getElementById("admin-manager-warning");
  const nameInput = document.getElementById("admin-create-name");
  const emailInput = document.getElementById("admin-create-email");
  const passwordInput = document.getElementById("admin-create-password");
  const submitButton = document.getElementById("admin-create-submit");
  const usersBody = document.getElementById("admin-users-body");
  const usersCount = document.getElementById("admin-users-count");
  const feedback = document.getElementById("admin-users-feedback");

  let currentRole = "";
  let currentUserId = "";

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }

    return new Date(value).toLocaleDateString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function formatRoleLabel(role) {
    if (role === "manager") {
      return "Gerente";
    }

    if (role === "gerenteUSA") {
      return "Gerente USA";
    }

    if (role === "admin") {
      return "Administrador";
    }

    if (role === "adminUSA") {
      return "Administrador USA";
    }

    return String(role || "-");
  }

  function canManageAdministrativeUsers() {
    return typeof canCreateAdministrativeUsers === "function"
      ? canCreateAdministrativeUsers(currentRole)
      : ["manager", "gerenteUSA"].includes(currentRole);
  }

  function canDeleteAdministrativeUser(user) {
    const userId = String(user?._id || user?.id || "").trim();
    const userRole = String(user?.role || "").trim();

    if (!canManageAdministrativeUsers() || !userId || userId === currentUserId) {
      return false;
    }

    if (currentRole === "manager") {
      return userRole === "admin";
    }

    if (currentRole === "gerenteUSA") {
      return userRole === "adminUSA";
    }

    return false;
  }

  async function deleteAdministrativeUserRequest(administrativeUserId) {
    const candidatePaths = [
      `/api/admin/users/admins/${encodeURIComponent(administrativeUserId)}`,
      `/api/admin/admins/${encodeURIComponent(administrativeUserId)}`,
    ];

    let lastError = null;

    for (const path of candidatePaths) {
      try {
        return await fetchJson(path, {
          method: "DELETE",
          loadingMessage: "Eliminando administrador...",
        });
      } catch (error) {
        lastError = error;

        if (!/route not found/i.test(String(error?.message || ""))) {
          throw error;
        }
      }
    }

    throw lastError || new Error("No se pudo eliminar el administrador.");
  }

  function renderUsers(users) {
    const list = Array.isArray(users) ? users : [];

    usersCount.textContent = `${list.length} usuario(s)`;

    if (!list.length) {
      usersBody.innerHTML = '<tr><td colspan="6"><div class="empty-state">No hay usuarios administrativos creados.</div></td></tr>';
      return;
    }

    usersBody.innerHTML = list
      .map((user) => {
        const isActive = user.isActive !== false;
        const userId = String(user._id || user.id || "").trim();
        const canDelete = canDeleteAdministrativeUser(user);
        const deleteCellMarkup = canDelete
          ? `<button class="admin-user-delete-button" type="button" data-delete-admin-id="${escapeHtml(userId)}" data-delete-admin-name="${escapeHtml(user.name || user.email || "administrador")}" aria-label="Eliminar administrador">x</button>`
          : '<span class="admin-user-delete-placeholder">-</span>';

        return `
          <tr>
            <td data-label="Nombre">${escapeHtml(user.name || "-")}</td>
            <td data-label="Email">${escapeHtml(user.email || "-")}</td>
            <td data-label="Rol">${escapeHtml(formatRoleLabel(user.role))}</td>
            <td data-label="Estado">${isActive ? "Activo" : "Inactivo"}</td>
            <td data-label="Creado">${escapeHtml(formatDate(user.createdAt))}</td>
            <td data-label="Acciones" class="admin-users-actions-cell">${deleteCellMarkup}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadAdministrativeUsers() {
    const data = await fetchJson("/api/admin/users/admins", {
      loadingMessage: "Cargando usuarios administrativos...",
    });

    renderUsers(data.users || []);
  }

  function updateCreateAvailability() {
    const canCreateAdmins = canManageAdministrativeUsers();

    if (createCard) {
      createCard.hidden = !canCreateAdmins;
    }

    if (managerWarning) {
      managerWarning.hidden = canCreateAdmins;
    }

    if (submitButton) {
      submitButton.disabled = !canCreateAdmins;
    }
  }

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const canCreateAdmins = canManageAdministrativeUsers();

    if (!canCreateAdmins) {
      setFeedback(feedback, "Solo un rol de gerente puede crear administradores.", "error");
      return;
    }

    const name = String(nameInput?.value || "").trim();
    const email = String(emailInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!name || !email || !password) {
      setFeedback(feedback, "Completa nombre, email y contraseña.", "error");
      return;
    }

    submitButton.disabled = true;
    setFeedback(feedback, "Creando administrador...");

    try {
      await fetchJson("/api/admin/users/admins", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
        loadingMessage: "Creando administrador...",
      });

      createForm.reset();
      setFeedback(feedback, "Administrador creado correctamente.", "success");
      await loadAdministrativeUsers();
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  usersBody?.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-admin-id]");

    if (!deleteButton) {
      return;
    }

    const administrativeUserId = String(deleteButton.getAttribute("data-delete-admin-id") || "").trim();
    const administrativeUserName = String(deleteButton.getAttribute("data-delete-admin-name") || "este administrador").trim();

    if (!administrativeUserId || !canManageAdministrativeUsers()) {
      setFeedback(feedback, "No tienes permisos para eliminar administradores.", "error");
      return;
    }

    const isConfirmed = window.confirm(`¿Seguro que quieres eliminar a ${administrativeUserName}?`);

    if (!isConfirmed) {
      return;
    }

    deleteButton.disabled = true;
    setFeedback(feedback, "Eliminando administrador...");

    try {
      await deleteAdministrativeUserRequest(administrativeUserId);

      setFeedback(feedback, "Administrador eliminado correctamente.", "success");
      await loadAdministrativeUsers();
    } catch (error) {
      deleteButton.disabled = false;
      setFeedback(feedback, error.message, "error");
    }
  });

  loadAdminSession()
    .then((user) => {
      currentRole = String(user?.role || "");
      currentUserId = String(user?._id || user?.id || "").trim();
      updateCreateAvailability();
      return loadAdministrativeUsers();
    })
    .catch((error) => {
      usersBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${escapeHtml(error.message || "No se pudo cargar la sesión administrativa")}</div></td></tr>`;
      setFeedback(feedback, error.message || "No se pudieron cargar los usuarios administrativos.", "error");
    });
})();
