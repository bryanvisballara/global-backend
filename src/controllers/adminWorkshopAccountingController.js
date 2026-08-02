const MechanicServiceOrder = require("../models/MechanicServiceOrder");
const WorkshopPaymentPlan = require("../models/WorkshopPaymentPlan");
const CotizadorSettings = require("../models/CotizadorSettings");

const BUSINESS_TIMEZONE = "America/Bogota";

function canAccess(user) {
  return ["admin", "manager"].includes(String(user?.role || ""));
}

function toBusinessDayKey(dateValue, timeZone = BUSINESS_TIMEZONE) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function periodBounds(fromKey, toKey) {
  const from = String(fromKey || "").trim();
  const to = String(toKey || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return null;
  }
  // Inclusive Bogotá calendar days → UTC instants with buffer
  const start = new Date(`${from}T00:00:00.000-05:00`);
  const end = new Date(`${to}T23:59:59.999-05:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return null;
  }
  return { from, to, start, end };
}

function defaultTiers() {
  return [
    { minServices: 0, maxServices: 5, ratePerService: 150000 },
    { minServices: 6, maxServices: 10, ratePerService: 130000 },
    { minServices: 11, maxServices: 20, ratePerService: 120000 },
    { minServices: 21, maxServices: 30, ratePerService: 110000 },
    { minServices: 31, maxServices: null, ratePerService: 100000 },
  ];
}

function serializePlan(plan) {
  const plain = plan.toObject ? plan.toObject() : plan;
  return {
    id: String(plain._id),
    name: plain.name || "Plan mecánico taller",
    currency: plain.currency || "COP",
    windowDays: Number(plain.windowDays) || 15,
    tiers: Array.isArray(plain.tiers) ? plain.tiers : defaultTiers(),
    isActive: Boolean(plain.isActive),
    notes: plain.notes || "",
    updatedAt: plain.updatedAt,
  };
}

async function getOrCreateActivePlan() {
  let plan = await WorkshopPaymentPlan.findOne({ isActive: true }).sort({ updatedAt: -1 });
  if (!plan) {
    plan = await WorkshopPaymentPlan.create({
      name: "Plan mecánico taller",
      windowDays: 15,
      tiers: defaultTiers(),
      isActive: true,
      notes: "Tarifa por mantenimiento según volumen en la ventana (ej. 15 días).",
    });
  }
  return plan;
}

function normalizeTiers(rawTiers) {
  if (!Array.isArray(rawTiers) || !rawTiers.length) {
    return defaultTiers();
  }
  return rawTiers
    .map((tier) => ({
      minServices: Math.max(0, Number(tier.minServices) || 0),
      maxServices:
        tier.maxServices === "" || tier.maxServices == null || Number.isNaN(Number(tier.maxServices))
          ? null
          : Math.max(0, Number(tier.maxServices)),
      ratePerService: Math.max(0, Number(tier.ratePerService) || 0),
    }))
    .sort((left, right) => left.minServices - right.minServices);
}

function resolveTier(serviceCount, tiers) {
  const count = Math.max(0, Number(serviceCount) || 0);
  const sorted = normalizeTiers(tiers);
  let match = sorted[0] || { minServices: 0, maxServices: null, ratePerService: 0 };
  for (const tier of sorted) {
    const max = tier.maxServices == null ? Infinity : Number(tier.maxServices);
    if (count >= tier.minServices && count <= max) {
      match = tier;
    }
  }
  return match;
}

function money(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value));
}

function computeBillingTotals(billing = {}, suggestedLaborCost = null) {
  const billedAmount = money(billing.billedAmount) ?? 0;
  const partsCost = money(billing.partsCost) ?? 0;
  const laborCost = money(billing.laborCost) ?? (suggestedLaborCost != null ? money(suggestedLaborCost) : 0) ?? 0;
  const serviceCost =
    money(billing.serviceCost) ??
    partsCost + laborCost;
  const profit = money(billing.profit) ?? billedAmount - serviceCost;
  return {
    billedAmount,
    partsCost,
    laborCost,
    serviceCost,
    profit,
    usedSuggestedLabor: money(billing.laborCost) == null && suggestedLaborCost != null,
  };
}

function serviceDate(order) {
  return order.completedAt || order.appointmentDate || order.createdAt || null;
}

function serializeAccountingOrder(order, suggestedLaborCost) {
  const billing = order.billing || {};
  const totals = computeBillingTotals(billing, suggestedLaborCost);
  const vehicle = order.vehicle || {};
  const createdBy = order.createdBy || null;
  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    technicianName: order.technicianName || createdBy?.name || "Sin técnico",
    technicianId: createdBy?._id ? String(createdBy._id) : "",
    clientName: order.client?.name || "",
    vehicleLabel: [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Vehículo",
    plate: vehicle.plate || "",
    serviceDate: serviceDate(order),
    dayKey: toBusinessDayKey(serviceDate(order)),
    billing: {
      billedAmount: money(billing.billedAmount),
      partsCost: money(billing.partsCost),
      laborCost: money(billing.laborCost),
      serviceCost: money(billing.serviceCost),
      profit: money(billing.profit),
      currency: billing.currency || "COP",
      notes: billing.notes || "",
      pricedAt: billing.pricedAt || null,
    },
    computed: totals,
    suggestedLaborCost: suggestedLaborCost != null ? money(suggestedLaborCost) : null,
  };
}

async function getWorkshopAccounting(req, res) {
  try {
    if (!canAccess(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const bounds = periodBounds(req.query.from, req.query.to);
    if (!bounds) {
      return res.status(400).json({ message: "Indica un rango de fechas válido (from / to)" });
    }

    const [plan, settings, orders] = await Promise.all([
      getOrCreateActivePlan(),
      CotizadorSettings.findOne().lean(),
      MechanicServiceOrder.find({
        status: { $in: ["diagnosis_saved", "closed"] },
        $or: [
          { completedAt: { $gte: bounds.start, $lte: bounds.end } },
          {
            completedAt: null,
            createdAt: { $gte: bounds.start, $lte: bounds.end },
          },
        ],
      })
        .populate("createdBy", "name email")
        .sort({ completedAt: -1, createdAt: -1 })
        .limit(500)
        .lean(),
    ]);

    const catalogLabor = money(settings?.laborPrice) ?? 150000;
    const byTechnician = new Map();

    for (const order of orders) {
      const key = String(order.createdBy?._id || order.technicianName || "sin-tecnico").trim().toLowerCase();
      if (!byTechnician.has(key)) {
        byTechnician.set(key, {
          key,
          technicianId: order.createdBy?._id ? String(order.createdBy._id) : "",
          technicianName: order.technicianName || order.createdBy?.name || "Sin técnico",
          orders: [],
        });
      }
      byTechnician.get(key).orders.push(order);
    }

    const technicians = [];
    const serializedOrders = [];

    for (const group of byTechnician.values()) {
      const count = group.orders.length;
      const tier = resolveTier(count, plan.tiers);
      const rate = money(tier.ratePerService) ?? 0;
      let billed = 0;
      let cost = 0;
      let profit = 0;
      let labor = 0;
      let parts = 0;

      for (const order of group.orders) {
        const row = serializeAccountingOrder(order, rate);
        serializedOrders.push(row);
        billed += row.computed.billedAmount;
        cost += row.computed.serviceCost;
        profit += row.computed.profit;
        labor += row.computed.laborCost;
        parts += row.computed.partsCost;
      }

      technicians.push({
        technicianId: group.technicianId,
        technicianName: group.technicianName,
        servicesCount: count,
        tier: {
          minServices: tier.minServices,
          maxServices: tier.maxServices,
          ratePerService: rate,
        },
        mechanicPayTotal: count * rate,
        billedAmount: billed,
        partsCost: parts,
        laborCost: labor,
        serviceCost: cost,
        profit,
      });
    }

    technicians.sort((a, b) => b.servicesCount - a.servicesCount || a.technicianName.localeCompare(b.technicianName));
    serializedOrders.sort((a, b) => String(b.serviceDate || "").localeCompare(String(a.serviceDate || "")));

    const summary = serializedOrders.reduce(
      (acc, row) => {
        acc.servicesCount += 1;
        acc.billedAmount += row.computed.billedAmount;
        acc.partsCost += row.computed.partsCost;
        acc.laborCost += row.computed.laborCost;
        acc.serviceCost += row.computed.serviceCost;
        acc.profit += row.computed.profit;
        return acc;
      },
      {
        servicesCount: 0,
        billedAmount: 0,
        partsCost: 0,
        laborCost: 0,
        serviceCost: 0,
        profit: 0,
        mechanicPayTotal: technicians.reduce((sum, item) => sum + item.mechanicPayTotal, 0),
      }
    );
    summary.netAfterMechanicPay = summary.profit; // labor already in serviceCost when linked to plan

    return res.status(200).json({
      period: { from: bounds.from, to: bounds.to },
      plan: serializePlan(plan),
      catalogLaborPrice: catalogLabor,
      summary,
      technicians,
      orders: serializedOrders,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading workshop accounting" });
  }
}

async function getPaymentPlan(req, res) {
  try {
    if (!canAccess(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }
    const plan = await getOrCreateActivePlan();
    return res.status(200).json({ plan: serializePlan(plan) });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error loading payment plan" });
  }
}

async function updatePaymentPlan(req, res) {
  try {
    if (!canAccess(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const plan = await getOrCreateActivePlan();
    if (req.body.name != null) plan.name = String(req.body.name || "").trim() || plan.name;
    if (req.body.notes != null) plan.notes = String(req.body.notes || "").trim().slice(0, 2000);
    if (req.body.windowDays != null) {
      const days = Number(req.body.windowDays);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        return res.status(400).json({ message: "windowDays debe estar entre 1 y 90" });
      }
      plan.windowDays = days;
    }
    if (req.body.tiers != null) {
      plan.tiers = normalizeTiers(req.body.tiers);
    }
    plan.updatedBy = req.user._id;
    await plan.save();

    return res.status(200).json({
      message: "Plan de pago actualizado",
      plan: serializePlan(plan),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating payment plan" });
  }
}

async function updateOrderBilling(req, res) {
  try {
    if (!canAccess(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const order = await MechanicServiceOrder.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ message: "Orden no encontrada" });
    }

    const billedAmount = req.body.billedAmount === "" || req.body.billedAmount == null
      ? null
      : money(req.body.billedAmount);
    const partsCost = req.body.partsCost === "" || req.body.partsCost == null
      ? null
      : money(req.body.partsCost);
    const laborCost = req.body.laborCost === "" || req.body.laborCost == null
      ? null
      : money(req.body.laborCost);

    let serviceCost = req.body.serviceCost === "" || req.body.serviceCost == null
      ? null
      : money(req.body.serviceCost);
    if (serviceCost == null && (partsCost != null || laborCost != null)) {
      serviceCost = (partsCost || 0) + (laborCost || 0);
    }

    let profit = req.body.profit === "" || req.body.profit == null
      ? null
      : money(req.body.profit);
    if (profit == null && billedAmount != null && serviceCost != null) {
      profit = billedAmount - serviceCost;
    }

    order.billing = {
      ...(order.billing?.toObject ? order.billing.toObject() : order.billing || {}),
      billedAmount,
      partsCost,
      laborCost,
      serviceCost,
      profit,
      currency: "COP",
      notes: String(req.body.notes || order.billing?.notes || "").trim().slice(0, 1000),
      pricedAt: new Date(),
    };
    await order.save();

    return res.status(200).json({
      message: "Costos del servicio actualizados",
      order: {
        id: String(order._id),
        billing: order.billing,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating billing" });
  }
}

async function applyPlanLaborToPeriod(req, res) {
  try {
    if (!canAccess(req.user)) {
      return res.status(403).json({ message: "Solo administración LATAM" });
    }

    const bounds = periodBounds(req.body.from, req.body.to);
    if (!bounds) {
      return res.status(400).json({ message: "Indica un rango de fechas válido" });
    }

    const plan = await getOrCreateActivePlan();
    const orders = await MechanicServiceOrder.find({
      status: { $in: ["diagnosis_saved", "closed"] },
      $or: [
        { completedAt: { $gte: bounds.start, $lte: bounds.end } },
        { completedAt: null, createdAt: { $gte: bounds.start, $lte: bounds.end } },
      ],
    }).populate("createdBy", "name");

    const groups = new Map();
    for (const order of orders) {
      const key = String(order.createdBy?._id || order.technicianName || "sin-tecnico").trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }

    let updated = 0;
    for (const groupOrders of groups.values()) {
      const tier = resolveTier(groupOrders.length, plan.tiers);
      const rate = money(tier.ratePerService) ?? 0;
      for (const order of groupOrders) {
        const partsCost = money(order.billing?.partsCost) ?? 0;
        const billedAmount = money(order.billing?.billedAmount);
        const laborCost = rate;
        const serviceCost = partsCost + laborCost;
        const profit = billedAmount == null ? null : billedAmount - serviceCost;
        order.billing = {
          ...(order.billing?.toObject ? order.billing.toObject() : order.billing || {}),
          billedAmount,
          partsCost: money(order.billing?.partsCost),
          laborCost,
          serviceCost,
          profit,
          currency: "COP",
          notes: order.billing?.notes || "",
          pricedAt: new Date(),
        };
        await order.save();
        updated += 1;
      }
    }

    return res.status(200).json({
      message: `Costo laboral del plan aplicado a ${updated} servicio(s)`,
      updated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error applying payment plan" });
  }
}

module.exports = {
  getWorkshopAccounting,
  getPaymentPlan,
  updatePaymentPlan,
  updateOrderBilling,
  applyPlanLaborToPeriod,
};
