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

async function seedClient() {
  validateSeedEnv();
  await connectToDatabase();

  const name = (process.env.GLOBAL_CLIENT_NAME || "Cliente Demo").trim();
  const email = (process.env.GLOBAL_CLIENT_EMAIL || "cliente@globalimports.com").trim().toLowerCase();
  const password = process.env.GLOBAL_CLIENT_PASSWORD || "ClienteGlobal123!";
  const phone = (process.env.GLOBAL_CLIENT_PHONE || "+58 412-000-0000").trim();
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.findOneAndUpdate(
    { email },
    {
      name,
      email,
      phone,
      password: hashedPassword,
      role: "client",
      isActive: true,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  console.log("Client seed ready");
  console.log(`name: ${user.name}`);
  console.log(`email: ${user.email}`);
  console.log(`password: ${password}`);
  console.log(`phone: ${user.phone || phone}`);
}

if (require.main === module) {
  seedClient()
    .catch((error) => {
      console.error("Failed to seed client", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}

module.exports = {
  seedClient,
};