const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const { createClient, listUsers } = require("../controllers/adminUsersController");
const { listClientRequests } = require("../controllers/adminClientRequestsController");
const {
  createOrder,
  getOrder,
  listOrders,
  updateOrder,
  updateTrackingStep,
} = require("../controllers/adminOrdersController");
const { listMaintenance, updateMaintenance } = require("../controllers/adminMaintenanceController");
const { createPost, listPosts } = require("../controllers/adminPostsController");
const { upload } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/users", listUsers);
router.post("/users/clients", createClient);
router.get("/client-requests", listClientRequests);

router.get("/orders", listOrders);
router.post("/orders", createOrder);
router.get("/orders/:orderId", getOrder);
router.patch("/orders/:orderId", updateOrder);
router.patch("/orders/:orderId/tracking-steps/:stepKey", updateTrackingStep);

router.get("/maintenance", listMaintenance);
router.patch("/maintenance/:maintenanceId", updateMaintenance);

router.get("/posts", listPosts);
router.post("/posts", upload.array("mediaFiles", 10), createPost);

module.exports = router;