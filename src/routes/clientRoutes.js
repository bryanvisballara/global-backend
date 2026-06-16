const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const {
  createDocuSignPreagreementSigningUrl,
  createAuthenticatedClientRequest,
  createClientMaintenanceVehicle,
  createClientPostComment,
  deleteClientMaintenanceVehicle,
  deleteClientPostComment,
  dismissClientNotification,
  getClientDashboard,
  listClientVirtualDealershipVehicles,
  listClientPosts,
  registerClientPushDevice,
  toggleClientPostCommentLike,
  toggleClientPostLike,
  updateClientMaintenanceVehicle,
  updateClientMaintenance,
} = require("../controllers/clientPortalController");
const {
  listGlobalHeroLeaderboard,
  submitGlobalHeroScore,
} = require("../controllers/globalHeroController");

const router = express.Router();

router.use(requireAuth, requireRole("client"));

router.get("/dashboard", getClientDashboard);
router.get("/posts", listClientPosts);
router.post("/posts/:postId/like", toggleClientPostLike);
router.post("/posts/:postId/comments", createClientPostComment);
router.delete("/posts/:postId/comments/:commentId", deleteClientPostComment);
router.post("/posts/:postId/comments/:commentId/like", toggleClientPostCommentLike);
router.get("/virtual-dealership", listClientVirtualDealershipVehicles);
router.post("/maintenance-vehicles", createClientMaintenanceVehicle);
router.patch("/maintenance-vehicles/:vehicleId", updateClientMaintenanceVehicle);
router.delete("/maintenance-vehicles/:vehicleId", deleteClientMaintenanceVehicle);
router.delete("/notifications/:notificationId", dismissClientNotification);
router.post("/push-devices", registerClientPushDevice);
router.post("/docusign/preagreement-signing-url", createDocuSignPreagreementSigningUrl);
router.post("/requests", createAuthenticatedClientRequest);
router.patch("/maintenance/:maintenanceId/report", updateClientMaintenance);
router.get("/global-hero/leaderboard", listGlobalHeroLeaderboard);
router.post("/global-hero/scores", submitGlobalHeroScore);

module.exports = router;