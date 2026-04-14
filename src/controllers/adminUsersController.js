const User = require("../models/User");
const bcrypt = require("bcryptjs");

const LATAM_ADMIN_ROLES = ["manager", "admin"];
const USA_ADMIN_ROLES = ["gerenteUSA", "adminUSA"];

function isUsaAdministrativeRole(role) {
  return USA_ADMIN_ROLES.includes(String(role || ""));
}

async function listUsers(req, res) {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });

    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching users" });
  }
}

async function listAdministrativeUsers(req, res) {
  try {
    const rolesToList = isUsaAdministrativeRole(req.user?.role) ? USA_ADMIN_ROLES : LATAM_ADMIN_ROLES;

    const users = await User.find({ role: { $in: rolesToList } })
      .select("-password")
      .sort({ createdAt: -1 });

    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching administrative users" });
  }
}

async function createAdministrativeUser(req, res) {
  try {
    const requesterRole = String(req.user?.role || "");
    const isLatamManager = requesterRole === "manager";
    const isUsaManager = requesterRole === "gerenteUSA";

    if (!isLatamManager && !isUsaManager) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedName = String(name).trim();

    if (!normalizedName) {
      return res.status(400).json({ message: "Name is required" });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).select("_id");

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      role: isUsaManager ? "adminUSA" : "admin",
      isActive: true,
    });

    return res.status(201).json({
      message: "Administrative user created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error creating administrative user" });
  }
}

module.exports = {
  listUsers,
  listAdministrativeUsers,
  createAdministrativeUser,
};