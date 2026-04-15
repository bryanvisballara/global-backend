const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const {
  listUsers,
  listAdministrativeUsers,
  createAdministrativeUser,
} = require("../controllers/adminUsersController");
const { createClient, listClients } = require("../controllers/adminClientsController");
const { listClientRequests } = require("../controllers/adminClientRequestsController");
const {
  createOrder,
  getOrder,
  listOrders,
  suggestTrackingNumber,
  updateOrder,
  updateTrackingState,
} = require("../controllers/adminOrdersController");
const { listMaintenance, updateMaintenance, updateClientMaintenanceVehicle } = require("../controllers/adminMaintenanceController");
const { createPost, deletePost, getPost, listPosts, updatePost } = require("../controllers/adminPostsController");
const {
  createVirtualDealershipVehicle,
  deleteVirtualDealershipVehicle,
  listVirtualDealershipVehicles,
  updateVirtualDealershipVehicle,
} = require("../controllers/adminVirtualDealershipController");

const signedDocumentUpload = require("../middleware/upload");
const { upload } = require("../middleware/uploadMiddleware");
const signedDocumentController = require("../controllers/signedDocumentController");
const router = express.Router();
// Documentos firmados (DocuSign)
router.post("/signed-documents", signedDocumentUpload.single("pdf"), signedDocumentController.uploadSignedDocument);
router.get("/signed-documents", signedDocumentController.listSignedDocuments);
router.get("/signed-documents/:id/download", signedDocumentController.downloadSignedDocument);

function requireLatamAdministrativeRole(req, res, next) {
  if (["admin", "manager"].includes(String(req.user?.role || ""))) {
    return next();
  }

  return res.status(403).json({ message: "Modulo disponible solo para Global Imports LATAM" });
}

router.use(requireAuth, requireRole("admin", "manager", "adminUSA", "gerenteUSA"));

router.get("/users", listUsers);
router.get("/users/admins", listAdministrativeUsers);
router.post("/users/admins", requireRole("manager", "gerenteUSA"), createAdministrativeUser);
router.get("/clients", listClients);
router.post("/clients", createClient);
router.post("/users/clients", createClient);
router.get("/client-requests", requireLatamAdministrativeRole, listClientRequests);
router.get("/tracking-suggestion", suggestTrackingNumber);

router.get("/orders", listOrders);
router.post("/orders", upload.array("mediaFiles", 10), createOrder);
router.get("/orders/:orderId", getOrder);
router.patch("/orders/:orderId", updateOrder);
router.patch("/orders/:orderId/tracking-states/:stepKey", upload.array("mediaFiles", 10), updateTrackingState);
router.patch("/orders/:orderId/tracking-steps/:stepKey", upload.array("mediaFiles", 10), updateTrackingState);

router.get("/maintenance", listMaintenance);
router.patch("/maintenance/:maintenanceId", updateMaintenance);
router.patch("/maintenance-vehicles/:vehicleId", updateClientMaintenanceVehicle);

router.get("/posts", listPosts);
router.get("/posts/:postId", getPost);
router.post("/posts", upload.array("mediaFiles", 10), createPost);
router.patch("/posts/:postId", updatePost);
router.delete("/posts/:postId", deletePost);

router.get("/virtual-dealership", listVirtualDealershipVehicles);
router.post(
  "/virtual-dealership",
  upload.array("mediaFiles", 10),
  createVirtualDealershipVehicle
);
router.patch("/virtual-dealership/:vehicleId", updateVirtualDealershipVehicle);
router.delete("/virtual-dealership/:vehicleId", deleteVirtualDealershipVehicle);

module.exports = router;