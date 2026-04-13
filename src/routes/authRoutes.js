const express = require("express");
const {
	login,
	logout,
	me,
	startRegistrationVerification,
	verifyRegistrationCode,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", startRegistrationVerification);
router.post("/register/verify", verifyRegistrationCode);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);

module.exports = router;
