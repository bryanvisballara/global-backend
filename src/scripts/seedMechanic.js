require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("Missing MONGODB_URI");
  }

  await mongoose.connect(mongoUri);

  const email = String(process.env.MECHANIC_SEED_EMAIL || "mecanico@globalimports.app").toLowerCase().trim();
  const password = String(process.env.MECHANIC_SEED_PASSWORD || "Mecanico123!");
  const name = String(process.env.MECHANIC_SEED_NAME || "Mecánico Global").trim();

  let user = await User.findOne({ email });
  if (user) {
    user.role = "mechanic";
    user.password = await bcrypt.hash(password, 10);
    user.isActive = true;
    user.name = name;
    await user.save();
    console.log(`Updated mechanic user: ${email}`);
  } else {
    user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 10),
      role: "mechanic",
      isActive: true,
    });
    console.log(`Created mechanic user: ${email}`);
  }

  console.log(`Password: ${password}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_error) {
    // ignore
  }
  process.exit(1);
});
