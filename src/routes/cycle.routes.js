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
const { updateLatestCycleDetails } = require("../controllers/cycle.controller");
const { getPreviousCycleandPredictionDetails } = require("../controllers/cycle.controller");
const { checkLatestPeriodLogged } = require("../controllers/cycle.controller");

router.get("/prediction",authenticate, getCyclePrediction);
router.get("/cycle-details", authenticate, getPreviousCycleDetails);
router.post("/period-date", authenticate, logLatestPeriod);
router.put("/last-period", authenticate, updateLatestCycleDetails);
router.get("/cycle-hormones", authenticate, getCycleHormoneData);
router.post("/daily-log", authenticate, createDailyLog);
router.get("/daily-log", authenticate, getTodayLog);
router.get("/cycle-history", authenticate, getUserPeriodLogs);
router.get("/period-status", authenticate, checkLatestPeriodLogged);
router.get("/cycle-details-prediction", authenticate, getPreviousCycleandPredictionDetails);


module.exports = router;
