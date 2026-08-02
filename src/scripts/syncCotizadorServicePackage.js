require("dotenv").config({ quiet: true });
const { connectToDatabase } = require("../config/db");
const { syncMaintenanceServicePackage } = require("../services/cotizadorServicePackage");

async function main() {
  await connectToDatabase();
  const result = await syncMaintenanceServicePackage();
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
