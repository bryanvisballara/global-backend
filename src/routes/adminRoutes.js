const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const {
  listUsers,
  listAdministrativeUsers,
  createAdministrativeUser,
  deleteAdministrativeUser,
} = require("../controllers/adminUsersController");
const { createClient, deleteClient, listClients, updateClient } = require("../controllers/adminClientsController");
const { listDeletedAccounts } = require("../controllers/adminDeletedAccountsController");
const { listClientRequests } = require("../controllers/adminClientRequestsController");
const {
  addOrderAccountingExpense,
  createOrder,
  deleteOrderAccountingExpense,
  deleteOrderDocument,
  deleteTrackingUpdate,
  finalizeTrackingOrder,
  getOrder,
  listOrderDeletionRequests,
  listOrders,
  requestOrderDeletion,
  reviewTrackingEventDeletionRequest,
  reviewOrderDeletionRequest,
  suggestTrackingNumber,
  toggleOrderDocumentVisibility,
  toggleTrackingEventVisibility,
  transitionTrackingState,
  uploadOrderDocuments,
  updateOrder,
  updateOrderDocument,
  updateOrderVehiclePricing,
  updateTrackingEvent,
  updateTrackingState,
} = require("../controllers/adminOrdersController");
const { listMaintenance, createManualMaintenance, backfillMaintenance, updateMaintenance, updateClientMaintenanceVehicle } = require("../controllers/adminMaintenanceController");
const { listDiagnosesForAdmin } = require("../controllers/mechanicPortalController");
const {
  getWorkshopAccounting,
  getPaymentPlan,
  updatePaymentPlan,
  updateOrderBilling,
  applyPlanLaborToPeriod,
} = require("../controllers/adminWorkshopAccountingController");
const {
  listVisits,
  createVisit,
  updateVisit,
  deleteVisit,
} = require("../controllers/adminVisitorsController");
const {
  getCotizadorOverview,
  getPricingBoard,
  getQuote,
  previewQuoteDocument,
  sendQuoteEmail,
  updateSettings,
  updateVehiclePricing,
  listSupplies,
  exportSuppliesXlsx,
  createSupply,
  updateSupply,
  importExcel,
  askCotizadorAi,
} = require("../controllers/adminCotizadorController");
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

router.use(requireAuth, requireRole("admin", "manager", "adminUSA", "gerenteUSA", "brokerUSA"));

router.get("/users", listUsers);
router.get("/users/admins", listAdministrativeUsers);
router.post("/users/admins", requireRole("manager", "gerenteUSA"), createAdministrativeUser);
router.delete("/users/admins/:adminUserId", requireRole("manager", "gerenteUSA"), deleteAdministrativeUser);
router.delete("/admins/:adminUserId", requireRole("manager", "gerenteUSA"), deleteAdministrativeUser);
router.get("/clients", listClients);
router.patch("/clients/:clientId", updateClient);
router.delete("/clients/:clientId", deleteClient);
router.get("/deleted-accounts", listDeletedAccounts);
router.post("/clients", createClient);
router.post("/users/clients", createClient);
router.get("/client-requests", requireLatamAdministrativeRole, listClientRequests);
router.get("/tracking-suggestion", suggestTrackingNumber);

router.get("/orders", listOrders);
router.get("/orders/deletion-requests", listOrderDeletionRequests);
router.post("/orders", upload.array("mediaFiles", 10), createOrder);
router.get("/orders/:orderId", getOrder);
router.patch("/orders/:orderId", updateOrder);
router.patch("/orders/:orderId/vehicle-pricing", requireLatamAdministrativeRole, updateOrderVehiclePricing);
router.post("/orders/:orderId/accounting-expenses", requireLatamAdministrativeRole, upload.single("evidence"), addOrderAccountingExpense);
router.delete("/orders/:orderId/accounting-expenses/:expenseId", requireLatamAdministrativeRole, deleteOrderAccountingExpense);
router.post("/orders/:orderId/documents", upload.array("mediaFiles", 10), uploadOrderDocuments);
router.patch("/orders/:orderId/documents/:documentId", updateOrderDocument);
router.patch("/orders/:orderId/documents/:documentId/visibility", toggleOrderDocumentVisibility);
router.delete("/orders/:orderId/documents/:documentId", deleteOrderDocument);
router.post("/orders/:orderId/deletion-request", requestOrderDeletion);
router.patch("/orders/:orderId/deletion-request", reviewOrderDeletionRequest);
router.patch("/orders/:orderId/tracking-events/:eventId/deletion-request", reviewTrackingEventDeletionRequest);
router.patch("/orders/:orderId/tracking-events/:eventId", updateTrackingEvent);
router.patch("/orders/:orderId/tracking-events/:eventId/visibility", toggleTrackingEventVisibility);
router.patch("/orders/:orderId/tracking-transition", transitionTrackingState);
router.patch("/orders/:orderId/tracking-finalize", finalizeTrackingOrder);
router.patch("/orders/:orderId/tracking-states/:stepKey", upload.array("mediaFiles", 10), updateTrackingState);
router.patch("/orders/:orderId/tracking-steps/:stepKey", upload.array("mediaFiles", 10), updateTrackingState);
router.delete("/orders/:orderId/tracking-states/:stepKey/updates/:updateIndex", deleteTrackingUpdate);

router.get("/maintenance", listMaintenance);
router.post("/maintenance", requireLatamAdministrativeRole, createManualMaintenance);
router.post("/maintenance/backfill-completed", requireLatamAdministrativeRole, backfillMaintenance);
router.patch("/maintenance/:maintenanceId", updateMaintenance);
router.patch("/maintenance-vehicles/:vehicleId", updateClientMaintenanceVehicle);
router.get("/mechanic-diagnoses", requireLatamAdministrativeRole, listDiagnosesForAdmin);
router.get("/workshop-accounting", requireLatamAdministrativeRole, getWorkshopAccounting);
router.get("/workshop-payment-plan", requireLatamAdministrativeRole, getPaymentPlan);
router.put("/workshop-payment-plan", requireLatamAdministrativeRole, updatePaymentPlan);
router.patch("/mechanic-diagnoses/:orderId/billing", requireLatamAdministrativeRole, updateOrderBilling);
router.post("/workshop-accounting/apply-plan-labor", requireLatamAdministrativeRole, applyPlanLaborToPeriod);
router.get("/visitors", requireLatamAdministrativeRole, listVisits);
router.post("/visitors", requireLatamAdministrativeRole, createVisit);
router.patch("/visitors/:visitId", requireLatamAdministrativeRole, updateVisit);
router.delete("/visitors/:visitId", requireLatamAdministrativeRole, deleteVisit);

router.get("/cotizador", requireLatamAdministrativeRole, getCotizadorOverview);
router.get("/cotizador/pricing", requireLatamAdministrativeRole, getPricingBoard);
router.get("/cotizador/quote", requireLatamAdministrativeRole, getQuote);
router.post("/cotizador/quote-document", requireLatamAdministrativeRole, previewQuoteDocument);
router.post("/cotizador/send-quote", requireLatamAdministrativeRole, sendQuoteEmail);
router.patch("/cotizador/settings", requireLatamAdministrativeRole, updateSettings);
router.patch("/cotizador/vehicles/:vehicleId/pricing", requireLatamAdministrativeRole, updateVehiclePricing);
router.get("/cotizador/supplies", requireLatamAdministrativeRole, listSupplies);
router.get("/cotizador/supplies/export", requireLatamAdministrativeRole, exportSuppliesXlsx);
router.post("/cotizador/supplies", requireLatamAdministrativeRole, createSupply);
router.patch("/cotizador/supplies/:supplyId", requireLatamAdministrativeRole, updateSupply);
router.post("/cotizador/import", requireLatamAdministrativeRole, upload.array("excelFiles", 10), importExcel);
router.post("/cotizador/ai", requireLatamAdministrativeRole, askCotizadorAi);

router.get("/posts", listPosts);
router.get("/posts/:postId", getPost);
router.post("/posts", upload.array("mediaFiles", 10), createPost);
router.patch("/posts/:postId", upload.array("mediaFiles", 10), updatePost);
router.delete("/posts/:postId", deletePost);

router.get("/virtual-dealership", listVirtualDealershipVehicles);
router.post(
  "/virtual-dealership",
  upload.array("mediaFiles", 10),
  createVirtualDealershipVehicle
);
router.patch("/virtual-dealership/:vehicleId", upload.array("mediaFiles", 10), updateVirtualDealershipVehicle);
router.delete("/virtual-dealership/:vehicleId", deleteVirtualDealershipVehicle);

module.exports = router;