const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiCycle.controller");
const { authenticate } = require("../middlewares/auth.middleware");

router.get("/cycle-insights",authenticate, aiController.getAiCycleInsights);

module.exports = router;