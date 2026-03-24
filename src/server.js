require("dotenv").config({ quiet: true });

const app = require("./app");
const { connectToDatabase, markDatabaseDisconnected } = require("./config/db");
const { validateEnv } = require("./config/env");
const User = require("./models/User");
const bcrypt = require("bcryptjs");

let isConnectingToDatabase = false;

async function seedAdminUser() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return;
  }

  const existingAdmin = await User.findOne({ email: ADMIN_EMAIL.toLowerCase().trim() });

  if (existingAdmin) {
    return;
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await User.create({
    name: ADMIN_NAME.trim(),
    email: ADMIN_EMAIL.toLowerCase().trim(),
    password: hashedPassword,
    role: "admin",
  });

  console.log("Admin user created from environment variables");
}

async function connectDatabaseWithRetry() {
  if (isConnectingToDatabase) {
    return;
  }

  isConnectingToDatabase = true;

  try {
    await connectToDatabase();
    await seedAdminUser();
  } catch (error) {
    markDatabaseDisconnected();
    console.error("MongoDB connection failed, retrying in 10 seconds", error.message);

    setTimeout(() => {
      connectDatabaseWithRetry().catch((retryError) => {
        console.error("Unexpected database retry error", retryError);
      });
    }, 10000);
  } finally {
    isConnectingToDatabase = false;
  }
}

async function startServer() {
  try {
    validateEnv();

    const port = process.env.PORT || 10000;

    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });

    await connectDatabaseWithRetry();
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();
