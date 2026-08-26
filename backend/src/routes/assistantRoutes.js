// routes/assistantRoutes.js
const express = require("express");
const router = express.Router();
const assistantController = require("../controllers/assistantController");

router.post("/chat", assistantController.chat);

module.exports = router;