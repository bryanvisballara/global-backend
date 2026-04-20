const DeletedAccount = require("../models/DeletedAccount");

async function listDeletedAccounts(req, res) {
  try {
    const deletedAccounts = await DeletedAccount.find()
      .sort({ deletedAt: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({ deletedAccounts });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error fetching deleted accounts" });
  }
}

module.exports = {
  listDeletedAccounts,
};