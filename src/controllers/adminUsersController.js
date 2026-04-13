const User = require("../models/User");

async function listUsers(req, res) {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });

    return res.status(200).json({ users });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching users" });
  }
}

module.exports = {
  listUsers,
};