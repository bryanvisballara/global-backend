const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const { upload } = require("../middleware/uploadMiddleware");
const {
  getPortalOverview,
  updateMechanicDefaults,
  createServiceOrder,
  getServiceOrder,
  updateServiceOrder,
  saveDiagnosis,
  downloadDiagnosisPdf,
} = require("../controllers/mechanicPortalController");

const router = express.Router();

router.use(requireAuth, requireRole("mechanic", "admin", "manager"));

router.get("/overview", getPortalOverview);
router.patch("/defaults", updateMechanicDefaults);
router.post("/orders", createServiceOrder);
router.get("/orders/:orderId", getServiceOrder);
router.patch("/orders/:orderId", updateServiceOrder);
router.post("/orders/:orderId/diagnosis", upload.array("photos", 10), saveDiagnosis);
router.get("/orders/:orderId/pdf", downloadDiagnosisPdf);

module.exports = router;
