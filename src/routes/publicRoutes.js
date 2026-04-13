const express = require("express");
const { getPublicTrackingOrder } = require("../controllers/clientPortalController");

const router = express.Router();

router.get("/tracking/:trackingNumber", getPublicTrackingOrder);

module.exports = router;
