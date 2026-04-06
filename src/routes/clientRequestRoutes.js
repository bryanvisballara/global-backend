const express = require("express");
const { createClientRequest } = require("../controllers/clientRequestController");

const router = express.Router();

router.post("/", createClientRequest);

module.exports = router;