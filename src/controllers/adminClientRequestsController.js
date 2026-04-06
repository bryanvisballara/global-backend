const ClientRequest = require("../models/ClientRequest");

async function listClientRequests(req, res) {
  try {
    const clientRequests = await ClientRequest.find()
      .populate("client", "name email phone role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ clientRequests });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching client requests" });
  }
}

module.exports = {
  listClientRequests,
};