require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const { connectToDatabase } = require("../config/db");
const { backfillCompletedOrderMaintenance } = require("../services/maintenanceScheduleService");

async function run() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing required environment variable: MONGODB_URI");
  }

  await connectToDatabase();
  const summary = await backfillCompletedOrderMaintenance();

  console.log("Maintenance backfill completed");
  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => null);
  });
