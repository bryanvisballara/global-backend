const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const {
  createAuthenticatedClientRequest,
  getClientDashboard,
  listClientPosts,
  updateClientMaintenance,
} = require("../controllers/clientPortalController");

const router = express.Router();

router.use(requireAuth, requireRole("client"));

router.get("/dashboard", getClientDashboard);
router.get("/posts", listClientPosts);
router.post("/requests", createAuthenticatedClientRequest);
router.patch("/maintenance/:maintenanceId/report", updateClientMaintenance);

module.exports = router;