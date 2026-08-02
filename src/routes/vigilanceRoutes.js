const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const { upload } = require("../middleware/uploadMiddleware");
const {
  getPortalOverview,
  listGateReports,
  getGateReport,
  createEntryReport,
  createDirectExitReport,
  closeExitReport,
} = require("../controllers/vigilancePortalController");

const router = express.Router();

router.use(requireAuth, requireRole("vigilance", "admin", "manager"));

router.get("/overview", getPortalOverview);
router.get("/gate-reports", listGateReports);
router.get("/gate-reports/:reportId", getGateReport);
router.post("/gate-reports/entry", upload.array("photos", 12), createEntryReport);
router.post("/gate-reports/direct-exit", upload.array("photos", 12), createDirectExitReport);
router.post("/gate-reports/:reportId/exit", upload.array("photos", 12), closeExitReport);

module.exports = router;
