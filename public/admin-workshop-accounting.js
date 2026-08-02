(() => {
  if (window.__adminWorkshopAccountingInitialized) return;
  window.__adminWorkshopAccountingInitialized = true;

  const {
    fetchJson,
    formatDate,
    setFeedback,
  } = window.AdminApp || {};

  const feedback = document.getElementById("acct-feedback")
    || document.getElementById("maintenance-feedback");
  const dateFrom = document.getElementById("acct-date-from");
  const dateTo = document.getElementById("acct-date-to");
  const applyFilterBtn = document.getElementById("acct-apply-filter");
  const applyPlanLaborBtn = document.getElementById("acct-apply-plan-labor");
  const servicesCountEl = document.getElementById("acct-services-count");
  const billedTotalEl = document.getElementById("acct-billed-total");
  const costTotalEl = document.getElementById("acct-cost-total");
  const profitTotalEl = document.getElementById("acct-profit-total");
  const mechanicPayTotalEl = document.getElementById("acct-mechanic-pay-total");
  const ordersBody = document.getElementById("acct-orders-body");
  const techBody = document.getElementById("acct-tech-body");
  const tiersList = document.getElementById("acct-tiers-list");
  const planWindow = document.getElementById("acct-plan-window");
  const addTierBtn = document.getElementById("acct-add-tier");
  const savePlanBtn = document.getElementById("acct-save-plan");
  const saveAllBillingBtn = document.getElementById("acct-save-all-billing");

  if (!document.getElementById("maint-tab-contabilidad")) return;

  let currentPlan = null;
  let currentPeriod = null;
  let accountingLoaded = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(value) {
    const amount = Number(value) || 0;
    return `$${amount.toLocaleString("es-CO")}`;
  }

  function setAcctNote(message, isError = false) {
    if (!feedback) return;
    feedback.textContent = message || "";
    feedback.style.color = isError ? "#b42318" : "#1f7a45";
  }

  function collectBillingPayload(row) {
    return {
      billedAmount: row.querySelector('[data-field="billedAmount"]')?.value,
      partsCost: row.querySelector('[data-field="partsCost"]')?.value,
      laborCost: row.querySelector('[data-field="laborCost"]')?.value,
    };
  }

  async function saveBillingRow(row) {
    const orderId = row?.dataset.orderId;
    if (!orderId) return;
    await fetchJson(`/api/admin/mechanic-diagnoses/${encodeURIComponent(orderId)}/billing`, {
      method: "PATCH",
      body: JSON.stringify(collectBillingPayload(row)),
      loadingMessage: "Guardando costos…",
    });
  }

  function todayKeyBogota() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const pick = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
  }

  function defaultPeriod() {
    const to = todayKeyBogota();
    const date = new Date(`${to}T12:00:00-05:00`);
    date.setDate(date.getDate() - 14);
    const fromParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (type) => fromParts.find((part) => part.type === type)?.value || "";
    return {
      from: `${pick("year")}-${pick("month")}-${pick("day")}`,
      to,
    };
  }

  function renderTiers(tiers = []) {
    if (!tiersList) return;
    const list = tiers.length
      ? tiers
      : [
          { minServices: 0, maxServices: 5, ratePerService: 150000 },
          { minServices: 6, maxServices: 10, ratePerService: 130000 },
          { minServices: 11, maxServices: 20, ratePerService: 120000 },
          { minServices: 21, maxServices: 30, ratePerService: 110000 },
          { minServices: 31, maxServices: null, ratePerService: 100000 },
        ];

    tiersList.innerHTML = list.map((tier, index) => `
      <div class="acct-tier-row" data-tier-index="${index}">
        <input type="number" min="0" data-tier-min placeholder="Min" value="${escapeHtml(tier.minServices ?? 0)}" />
        <input type="number" min="0" data-tier-max placeholder="Hasta (vacío = ∞)" value="${tier.maxServices == null ? "" : escapeHtml(tier.maxServices)}" />
        <input type="number" min="0" step="1000" data-tier-rate placeholder="Tarifa COP" value="${escapeHtml(tier.ratePerService ?? 0)}" />
        <button type="button" class="acct-tier-remove" data-remove-tier>Quitar</button>
      </div>
    `).join("");

    tiersList.querySelectorAll("[data-remove-tier]").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest(".acct-tier-row")?.remove();
      });
    });
  }

  function collectTiersFromDom() {
    return Array.from(tiersList?.querySelectorAll(".acct-tier-row") || []).map((row) => {
      const minServices = Number(row.querySelector("[data-tier-min]")?.value || 0);
      const maxRaw = row.querySelector("[data-tier-max]")?.value;
      const ratePerService = Number(row.querySelector("[data-tier-rate]")?.value || 0);
      return {
        minServices,
        maxServices: maxRaw === "" || maxRaw == null ? null : Number(maxRaw),
        ratePerService,
      };
    });
  }

  function renderSummary(summary = {}) {
    if (servicesCountEl) servicesCountEl.textContent = String(summary.servicesCount || 0);
    if (billedTotalEl) billedTotalEl.textContent = formatMoney(summary.billedAmount);
    if (costTotalEl) costTotalEl.textContent = formatMoney(summary.serviceCost);
    if (profitTotalEl) profitTotalEl.textContent = formatMoney(summary.profit);
    if (mechanicPayTotalEl) mechanicPayTotalEl.textContent = formatMoney(summary.mechanicPayTotal);
  }

  function renderTechnicians(technicians = []) {
    if (!techBody) return;
    if (!technicians.length) {
      techBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">Sin técnicos en este periodo.</div></td></tr>`;
      return;
    }
    techBody.innerHTML = technicians.map((tech) => {
      const maxLabel = tech.tier?.maxServices == null ? "+" : `-${tech.tier.maxServices}`;
      return `
        <tr>
          <td>${escapeHtml(tech.technicianName || "—")}</td>
          <td>${escapeHtml(tech.servicesCount || 0)} <small>(${escapeHtml(tech.tier?.minServices ?? 0)}${escapeHtml(maxLabel)})</small></td>
          <td>${formatMoney(tech.tier?.ratePerService)}</td>
          <td>${formatMoney(tech.mechanicPayTotal)}</td>
          <td>${formatMoney(tech.profit)}</td>
        </tr>
      `;
    }).join("");
  }

  function renderOrders(orders = []) {
    if (!ordersBody) return;
    if (!orders.length) {
      ordersBody.innerHTML = `<tr><td colspan="10"><div class="empty-state">No hay servicios en este periodo.</div></td></tr>`;
      return;
    }

    ordersBody.innerHTML = orders.map((order) => {
      const billing = order.billing || {};
      const computed = order.computed || {};
      const laborPlaceholder = order.suggestedLaborCost != null
        ? `Plan ${Number(order.suggestedLaborCost).toLocaleString("es-CO")}`
        : "Laboral";
      return `
        <tr data-order-id="${escapeHtml(order.id)}">
          <td>${order.serviceDate ? (formatDate?.(order.serviceDate) || "—") : "—"}</td>
          <td>${escapeHtml(order.orderNumber || "—")}</td>
          <td>${escapeHtml(order.technicianName || "—")}</td>
          <td>
            <strong>${escapeHtml(order.vehicleLabel || "—")}</strong><br />
            <span>${escapeHtml(order.plate || "—")}</span>
          </td>
          <td><input class="acct-money-input" data-field="billedAmount" type="number" min="0" step="1000" value="${billing.billedAmount ?? ""}" placeholder="Facturado" /></td>
          <td><input class="acct-money-input" data-field="partsCost" type="number" min="0" step="1000" value="${billing.partsCost ?? ""}" placeholder="Insumos" /></td>
          <td><input class="acct-money-input" data-field="laborCost" type="number" min="0" step="1000" value="${billing.laborCost ?? ""}" placeholder="${escapeHtml(laborPlaceholder)}" /></td>
          <td>${formatMoney(computed.serviceCost)}</td>
          <td>${formatMoney(computed.profit)}</td>
          <td><button type="button" class="acct-btn acct-btn-ghost" style="min-height:36px;padding:0.35rem 0.7rem;font-size:0.78rem;" data-save-billing>Guardar</button></td>
        </tr>
      `;
    }).join("");

    ordersBody.querySelectorAll("[data-save-billing]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest("tr");
        saveBillingRow(row)
          .then(() => {
            setAcctNote("Costos del servicio actualizados.");
            return loadAccounting();
          })
          .catch((error) => setAcctNote(error.message, true));
      });
    });
  }

  async function loadAccounting() {
    const from = dateFrom?.value || "";
    const to = dateTo?.value || "";
    if (!from || !to) {
      setAcctNote("Selecciona fechas desde y hasta.", true);
      return;
    }

    currentPeriod = { from, to };
    const data = await fetchJson(
      `/api/admin/workshop-accounting?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { loadingMessage: "Calculando contabilidad…" }
    );

    currentPlan = data.plan || null;
    if (planWindow && currentPlan) planWindow.value = String(currentPlan.windowDays || 15);
    renderTiers(currentPlan?.tiers || []);
    renderSummary(data.summary || {});
    renderTechnicians(data.technicians || []);
    renderOrders(data.orders || []);
    setAcctNote(`Periodo ${from} → ${to} | ${data.summary?.servicesCount || 0} servicio(s).`);
  }

  async function savePlan() {
    const payload = {
      windowDays: Number(planWindow?.value || 15),
      tiers: collectTiersFromDom(),
    };
    const result = await fetchJson("/api/admin/workshop-payment-plan", {
      method: "PUT",
      body: JSON.stringify(payload),
      loadingMessage: "Guardando plan…",
    });
    currentPlan = result.plan || currentPlan;
    renderTiers(currentPlan?.tiers || []);
    setAcctNote(result.message || "Plan guardado.");
    if (currentPeriod) await loadAccounting();
  }

  async function applyPlanLabor() {
    if (!currentPeriod) {
      setAcctNote("Primero aplica un periodo.", true);
      return;
    }
    const result = await fetchJson("/api/admin/workshop-accounting/apply-plan-labor", {
      method: "POST",
      body: JSON.stringify(currentPeriod),
      loadingMessage: "Vinculando plan al costo laboral…",
    });
    setAcctNote(result.message || "Plan aplicado.");
    await loadAccounting();
  }

  async function saveAllBilling() {
    const rows = Array.from(ordersBody?.querySelectorAll("tr[data-order-id]") || []);
    if (!rows.length) {
      setAcctNote("No hay servicios para guardar.", true);
      return;
    }
    for (const row of rows) {
      await saveBillingRow(row);
    }
    setAcctNote("Costos de todos los servicios guardados.");
    await loadAccounting();
  }

  function ensureDefaultDates() {
    const period = defaultPeriod();
    if (dateFrom && !dateFrom.value) dateFrom.value = period.from;
    if (dateTo && !dateTo.value) dateTo.value = period.to;
  }

  document.querySelectorAll("[data-maint-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.maintTab !== "contabilidad") return;
      ensureDefaultDates();
      if (!accountingLoaded) {
        accountingLoaded = true;
        loadAccounting().catch((error) => {
          accountingLoaded = false;
          setAcctNote(error.message, true);
        });
      }
    });
  });

  applyFilterBtn?.addEventListener("click", () => {
    loadAccounting().catch((error) => setAcctNote(error.message, true));
  });
  applyPlanLaborBtn?.addEventListener("click", () => {
    applyPlanLabor().catch((error) => setAcctNote(error.message, true));
  });
  addTierBtn?.addEventListener("click", () => {
    const tiers = collectTiersFromDom();
    const last = tiers[tiers.length - 1];
    const nextMin = last?.maxServices != null ? Number(last.maxServices) + 1 : (last?.minServices || 0) + 1;
    tiers.push({ minServices: nextMin, maxServices: null, ratePerService: 100000 });
    renderTiers(tiers);
  });
  savePlanBtn?.addEventListener("click", () => {
    savePlan().catch((error) => setAcctNote(error.message, true));
  });
  saveAllBillingBtn?.addEventListener("click", () => {
    saveAllBilling().catch((error) => setAcctNote(error.message, true));
  });

  ensureDefaultDates();
  renderTiers();
})();
