const Maintenance = require("../models/Maintenance");
const Order = require("../models/Order");
const { addMonths } = require("../utils/date");

const CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS = 6;

function toUtcNoon(dateValue) {
  const sourceDate = new Date(dateValue);

  if (Number.isNaN(sourceDate.getTime())) {
    return null;
  }

  return new Date(Date.UTC(
    sourceDate.getUTCFullYear(),
    sourceDate.getUTCMonth(),
    sourceDate.getUTCDate(),
    12,
    0,
    0,
    0
  ));
}

function isStepConfirmed(step) {
  if (!step) {
    return false;
  }

  if (typeof step.confirmed === "boolean") {
    return step.confirmed;
  }

  return Boolean(step?.confirmed);
}

function resolveOrderMaintenanceActivationDate(order) {
  const trackingSteps = Array.isArray(order?.trackingSteps) ? order.trackingSteps : [];
  const isCompletedOrder = String(order?.status || "").trim().toLowerCase() === "completed"
    && trackingSteps.length > 0
    && trackingSteps.every((step) => isStepConfirmed(step));

  if (!isCompletedOrder) {
    return null;
  }

  const deliveryStep = trackingSteps.find((step) => String(step?.key || "").trim() === "delivery");
  const deliveryDate = toUtcNoon(deliveryStep?.confirmedAt || deliveryStep?.updatedAt);

  if (deliveryDate) {
    return deliveryDate;
  }

  const completionDates = trackingSteps
    .map((step) => toUtcNoon(step?.confirmedAt || step?.updatedAt))
    .filter(Boolean);

  if (!completionDates.length) {
    return toUtcNoon(order?.updatedAt || order?.createdAt || order?.purchaseDate);
  }

  return completionDates.reduce(
    (latestDate, currentDate) => (currentDate.getTime() > latestDate.getTime() ? currentDate : latestDate),
    completionDates[0]
  );
}

function resolveMaintenanceDueDate(activationDate, months = CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS) {
  if (!activationDate) {
    return null;
  }

  return toUtcNoon(addMonths(activationDate, months));
}

function resolveMaintenanceStatus(dueDate, existingStatus) {
  const normalizedExisting = String(existingStatus || "").trim().toLowerCase();

  if (normalizedExisting === "completed" || normalizedExisting === "contacted") {
    return normalizedExisting;
  }

  if (!dueDate) {
    return "scheduled";
  }

  return dueDate.getTime() <= Date.now() ? "due" : "scheduled";
}

async function syncMaintenanceSchedule(order, adminUserId) {
  if (!order?._id) {
    return null;
  }

  if (!order.client) {
    await Maintenance.findOneAndDelete({ order: order._id, source: "order" });
    return null;
  }

  const activationDate = resolveOrderMaintenanceActivationDate(order);

  if (!activationDate) {
    await Maintenance.findOneAndDelete({ order: order._id, source: "order" });
    return null;
  }

  const dueDate = resolveMaintenanceDueDate(activationDate);

  if (!dueDate) {
    await Maintenance.findOneAndDelete({ order: order._id, source: "order" });
    return null;
  }

  const existing = await Maintenance.findOne({ order: order._id }).lean();
  const status = resolveMaintenanceStatus(dueDate, existing?.status);
  const createdBy = adminUserId || existing?.createdBy || order.createdBy || null;

  if (!createdBy) {
    return null;
  }

  return Maintenance.findOneAndUpdate(
    { order: order._id },
    {
      $set: {
        order: order._id,
        client: order.client,
        createdBy,
        source: "order",
        activationDate,
        dueDate,
        status,
        vehicleSnapshot: {
          brand: order?.vehicle?.brand || "",
          model: order?.vehicle?.model || "",
          version: order?.vehicle?.version || "",
          year: order?.vehicle?.year || null,
          vin: order?.vehicle?.vin || "",
          plate: order?.vehicle?.plate || "",
        },
        contactName: "",
        contactPhone: "",
        contactEmail: "",
      },
      $setOnInsert: {
        contactNotes: "",
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function backfillCompletedOrderMaintenance(adminUserId = null) {
  const completedOrders = await Order.find({ status: "completed" })
    .select("_id client createdBy status trackingSteps vehicle updatedAt createdAt purchaseDate")
    .lean();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const order of completedOrders) {
    const before = await Maintenance.findOne({ order: order._id }).select("_id").lean();
    const result = await syncMaintenanceSchedule(order, adminUserId || order.createdBy);

    if (!result) {
      skipped += 1;
      continue;
    }

    if (before) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  return {
    totalCompletedOrders: completedOrders.length,
    created,
    updated,
    skipped,
  };
}

function isSameMonthAndYear(leftDate, rightDate) {
  return (
    leftDate.getUTCFullYear() === rightDate.getUTCFullYear()
    && leftDate.getUTCMonth() === rightDate.getUTCMonth()
  );
}

function buildMonthKey(dateValue) {
  const date = toUtcNoon(dateValue);

  if (!date) {
    return "";
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(monthKey) {
  const normalized = String(monthKey || "").trim();
  const match = /^(\d{4})-(\d{2})$/.exec(normalized);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    monthIndex: month - 1,
    key: `${year}-${String(month).padStart(2, "0")}`,
  };
}

module.exports = {
  CLIENT_PREVENTIVE_MAINTENANCE_CYCLE_MONTHS,
  toUtcNoon,
  resolveOrderMaintenanceActivationDate,
  resolveMaintenanceDueDate,
  resolveMaintenanceStatus,
  syncMaintenanceSchedule,
  backfillCompletedOrderMaintenance,
  isSameMonthAndYear,
  buildMonthKey,
  parseMonthKey,
};
