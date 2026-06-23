const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiCycle.controller");
const { authenticate } = require("../middlewares/auth.middleware");

router.get("/cycle-insights",authenticate, aiController.getAiCycleInsights);
router.post("/user-insights",authenticate, aiController.getAiCycleInsightsWithInput);
router.post("/user-plan",authenticate, aiController.getCycleTripPlannerInsights);

module.exports = router;
