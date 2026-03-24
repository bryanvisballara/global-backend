require("dotenv").config();

const app = require("./app");
const { connectToDatabase } = require("./config/db");
const { validateEnv } = require("./config/env");
const User = require("./models/User");
const bcrypt = require("bcryptjs");

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

async function startServer() {
  try {
    validateEnv();
    await connectToDatabase();
    await seedAdminUser();

    const port = process.env.PORT || 10000;

    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

startServer();
