require("dotenv").config();

const mongoose = require("mongoose");
const Order = require("../models/Order");

const targetId = process.argv[2] || "";
const targetIdentifier = process.argv[3] || "";

function buildFallbackIdentifier(order) {
  const trackingNumber = String(order.trackingNumber || "").trim().toUpperCase();

  if (trackingNumber) {
    return `INT-${trackingNumber}`;
  }

  return `INT-${String(order._id).slice(-8).toUpperCase()}`;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  if (targetId && targetIdentifier) {
    await Order.updateOne(
      { _id: targetId },
      {
        $set: {
          "vehicle.internalIdentifier": targetIdentifier,
        },
      }
    );
  }

  const ordersMissingIdentifier = await Order.find({
    $or: [
      { "vehicle.internalIdentifier": { $exists: false } },
      { "vehicle.internalIdentifier": "" },
      { "vehicle.internalIdentifier": null },
    ],
  }).lean();

  let generatedCount = 0;

  for (const order of ordersMissingIdentifier) {
    const nextIdentifier = String(order.vehicle?.description || "").trim() || buildFallbackIdentifier(order);

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          "vehicle.internalIdentifier": nextIdentifier,
        },
      }
    );

    generatedCount += 1;
  }

  const targetOrder = targetId
    ? await Order.findById(targetId, {
        trackingNumber: 1,
        "vehicle.vin": 1,
        "vehicle.internalIdentifier": 1,
      }).lean()
    : null;

  const sample = await Order.find(
    {},
    {
      trackingNumber: 1,
      "vehicle.vin": 1,
      "vehicle.internalIdentifier": 1,
    }
  )
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  console.log(
    JSON.stringify(
      {
        targetId: targetId || null,
        targetIdentifier: targetIdentifier || null,
        generatedCount,
        targetOrder,
        sample,
      },
      null,
      2
    )
  );
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error(error);

    try {
      await mongoose.disconnect();
    } catch {}

    process.exit(1);
  });