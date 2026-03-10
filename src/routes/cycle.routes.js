const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const cycleController = require("../controllers/cycle.controller");
const { getPreviousCycleDetails } = require("../controllers/cycle.controller");
const { logLatestPeriod } = require("../controllers/cycle.controller");
const { getCycleHormoneData } = require("../controllers/cycle.controller");

router.get("/prediction",authenticate, cycleController.getCyclePrediction);
router.get("/cycle-details", authenticate, getPreviousCycleDetails);
router.post("/period-date", authenticate, logLatestPeriod);
router.get("/cycle-hormones", authenticate, getCycleHormoneData);

module.exports = router;