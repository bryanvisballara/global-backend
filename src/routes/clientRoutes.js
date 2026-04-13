const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const {
  createAuthenticatedClientRequest,
  createClientMaintenanceVehicle,
  deleteClientMaintenanceVehicle,
  dismissClientNotification,
  getClientDashboard,
  listClientVirtualDealershipVehicles,
  listClientPosts,
  registerClientPushDevice,
  updateClientMaintenanceVehicle,
  updateClientMaintenance,
} = require("../controllers/clientPortalController");

const router = express.Router();

router.use(requireAuth, requireRole("client"));

router.get("/dashboard", getClientDashboard);
router.get("/posts", listClientPosts);
router.get("/virtual-dealership", listClientVirtualDealershipVehicles);
router.post("/maintenance-vehicles", createClientMaintenanceVehicle);
router.patch("/maintenance-vehicles/:vehicleId", updateClientMaintenanceVehicle);
router.delete("/maintenance-vehicles/:vehicleId", deleteClientMaintenanceVehicle);
router.delete("/notifications/:notificationId", dismissClientNotification);
router.post("/push-devices", registerClientPushDevice);
router.post("/requests", createAuthenticatedClientRequest);
router.patch("/maintenance/:maintenanceId/report", updateClientMaintenance);

module.exports = router;