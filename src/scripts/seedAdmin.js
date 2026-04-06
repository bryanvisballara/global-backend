require("dotenv").config({ quiet: true });

const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { connectToDatabase } = require("../config/db");
const User = require("../models/User");

function validateSeedEnv() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing required environment variable: MONGODB_URI");
  }
}

async function seedAdmin() {
  validateSeedEnv();
  await connectToDatabase();

  const name = (process.env.GLOBAL_ADMIN_NAME || "Global Admin").trim();
  const email = (process.env.GLOBAL_ADMIN_EMAIL || "admin@globalimports.com").trim().toLowerCase();
  const password = process.env.GLOBAL_ADMIN_PASSWORD || "GlobalAdmin123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.findOneAndUpdate(
    { email },
    {
      name,
      email,
      password: hashedPassword,
      role: "admin",
      isActive: true,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  console.log("Admin seed ready");
  console.log(`email: ${user.email}`);
  console.log(`password: ${password}`);
}

if (require.main === module) {
  seedAdmin()
    .catch((error) => {
      console.error("Failed to seed admin", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  seedAdmin,
};