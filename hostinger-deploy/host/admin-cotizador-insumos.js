(() => {
  if (window.__adminCotizadorInsumosInitialized) {
    return;
  }
  window.__adminCotizadorInsumosInitialized = true;

  const { fetchJson, setFeedback } = window.AdminApp || {};

  const feedback = document.getElementById("ci-feedback");
  const searchInput = document.getElementById("ci-search");
  const typeSelect = document.getElementById("ci-type");
  const saveAllButton = document.getElementById("ci-save-all");
  const bodyEl = document.getElementById("ci-body");
  const countEl = document.getElementById("ci-count");

  let suppliesCache = [];
  const dirtyCosts = new Map();

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function money(value) {
    return `$${Number(value || 0).toLocaleString("es-CO")}`;
  }

  function getFilteredSupplies() {
    const query = String(searchInput?.value || "").trim().toLowerCase();
    const type = String(typeSelect?.value || "").trim();

    return suppliesCache.filter((supply) => {
      if (type && supply.type !== type) {
        return false;
      }
      if (!query) {
        return true;
      }
      const hay = [
        supply.typeLabel,
        supply.name,
        supply.specification,
        supply.oemCode,
        supply.provider,
      ].join(" ").toLowerCase();
      return hay.includes(query);
    });
  }

  function renderTable() {
    if (!bodyEl) {
      return;
    }

    const items = getFilteredSupplies();
    if (countEl) {
      const dirtyCount = dirtyCosts.size;
      countEl.textContent = dirtyCount
        ? `Mostrando ${items.length} de ${suppliesCache.length} insumos · ${dirtyCount} cambio(s) sin guardar`
        : `Mostrando ${items.length} de ${suppliesCache.length} insumos`;
    }

    if (!items.length) {
      bodyEl.innerHTML = `<tr><td colspan="6"><div class="empty-state">No hay insumos con ese filtro.</div></td></tr>`;
      return;
    }

    bodyEl.innerHTML = items.map((supply) => {
      const id = String(supply.id || supply._id || "");
      const currentCost = dirtyCosts.has(id)
        ? dirtyCosts.get(id)
        : Number(supply.unitCost || 0);
      const isDirty = dirtyCosts.has(id);
      const label = supply.type === "other"
        ? (supply.specification || supply.name || "Ítem")
        : (supply.specification || supply.name || "—");

      return `
        <tr data-supply-id="${escapeHtml(id)}" class="${isDirty ? "ci-dirty" : ""}">
          <td>${escapeHtml(supply.typeLabel || supply.type || "—")}</td>
          <td>
            <strong>${escapeHtml(label)}</strong>
            ${supply.type !== "other" && supply.name && supply.name !== label
              ? `<div class="ci-sub" style="margin:0.2rem 0 0">${escapeHtml(supply.name)}</div>`
              : ""}
          </td>
          <td>${escapeHtml(supply.oemCode || "—")}</td>
          <td>${Number(supply.compatibleCount || 0)}</td>
          <td>${Number(supply.stock || 0)}</td>
          <td>
            <input
              class="ci-cost-input"
              type="number"
              min="0"
              step="100"
              value="${currentCost}"
              data-original="${Number(supply.unitCost || 0)}"
            />
          </td>
        </tr>
      `;
    }).join("");

    bodyEl.querySelectorAll(".ci-cost-input").forEach((input) => {
      input.addEventListener("input", () => {
        const row = input.closest("tr[data-supply-id]");
        const id = row?.dataset.supplyId || "";
        const original = Number(input.dataset.original || 0);
        const next = Math.max(0, Number(input.value || 0));
        if (!id) {
          return;
        }
        if (next === original) {
          dirtyCosts.delete(id);
          row?.classList.remove("ci-dirty");
        } else {
          dirtyCosts.set(id, next);
          row?.classList.add("ci-dirty");
        }
        if (countEl) {
          const dirtyCount = dirtyCosts.size;
          const itemsCount = getFilteredSupplies().length;
          countEl.textContent = dirtyCount
            ? `Mostrando ${itemsCount} de ${suppliesCache.length} insumos · ${dirtyCount} cambio(s) sin guardar`
            : `Mostrando ${itemsCount} de ${suppliesCache.length} insumos`;
        }
      });
    });
  }

  async function loadSupplies() {
    const data = await fetchJson("/api/admin/cotizador/supplies");
    suppliesCache = (data.supplies || []).slice().sort((left, right) => {
      const byType = String(left.typeLabel || left.type || "").localeCompare(String(right.typeLabel || right.type || ""), "es");
      if (byType !== 0) return byType;
      return String(left.specification || left.name || "").localeCompare(String(right.specification || right.name || ""), "es");
    });
    dirtyCosts.clear();
    renderTable();
  }

  async function saveAllChanges() {
    if (!dirtyCosts.size) {
      setFeedback?.(feedback, "No hay cambios para guardar.", "error");
      return;
    }

    const entries = Array.from(dirtyCosts.entries());
    let saved = 0;
    for (const [supplyId, unitCost] of entries) {
      await fetchJson(`/api/admin/cotizador/supplies/${encodeURIComponent(supplyId)}`, {
        method: "PATCH",
        body: JSON.stringify({ unitCost }),
      });
      const supply = suppliesCache.find((item) => String(item.id || item._id) === supplyId);
      if (supply) {
        supply.unitCost = unitCost;
      }
      dirtyCosts.delete(supplyId);
      saved += 1;
    }

    renderTable();
    setFeedback?.(
      feedback,
      `Guardé ${saved} costo(s). Ya aplican en todos los mantenimientos que usen esos insumos.`,
      "success"
    );
  }

  searchInput?.addEventListener("input", renderTable);
  typeSelect?.addEventListener("change", renderTable);
  saveAllButton?.addEventListener("click", () => {
    saveAllChanges().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });

  loadSupplies().catch((error) => setFeedback?.(feedback, error.message, "error"));
})();
