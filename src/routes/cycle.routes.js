const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const {getCyclePrediction} = require("../controllers/cycle.controller");
const { getPreviousCycleDetails } = require("../controllers/cycle.controller");
const { logLatestPeriod } = require("../controllers/cycle.controller");
const { getCycleHormoneData } = require("../controllers/cycle.controller");
const { createDailyLog } = require("../controllers/cycle.controller");
const { getTodayLog } = require("../controllers/cycle.controller");
const { getUserPeriodLogs } = require("../controllers/cycle.controller");

router.get("/prediction",authenticate, getCyclePrediction);
router.get("/cycle-details", authenticate, getPreviousCycleDetails);
router.post("/period-date", authenticate, logLatestPeriod);
router.get("/cycle-hormones", authenticate, getCycleHormoneData);
router.post("/daily-log", authenticate, createDailyLog);
router.get("/daily-log", authenticate, getTodayLog);
router.get("/cycle-history", authenticate, getUserPeriodLogs);


module.exports = router;