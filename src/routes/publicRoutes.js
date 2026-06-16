const express = require("express");
const { getPublicTrackingOrder } = require("../controllers/clientPortalController");
const {
  listGlobalHeroLeaderboard,
  submitGlobalHeroScore,
} = require("../controllers/globalHeroController");

const router = express.Router();

router.get("/tracking/:trackingNumber", getPublicTrackingOrder);
router.get("/global-hero/leaderboard", listGlobalHeroLeaderboard);
router.post("/global-hero/scores", submitGlobalHeroScore);

module.exports = router;
