const express = require("express");
const {
	login,
	logout,
	deleteAccount,
	me,
	requestPasswordReset,
	resetPassword,
	startRegistrationVerification,
	verifyRegistrationCode,
} = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", startRegistrationVerification);
router.post("/register/verify", verifyRegistrationCode);
router.post("/forgot-password", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.post("/login", login);
router.post("/logout", logout);
router.post("/delete-account", requireAuth, deleteAccount);
router.get("/me", requireAuth, me);

module.exports = router;
