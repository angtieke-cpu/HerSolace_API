const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiCycle.controller");

router.get("/cycle-insights", aiController.getAiCycleInsights);

module.exports = router;