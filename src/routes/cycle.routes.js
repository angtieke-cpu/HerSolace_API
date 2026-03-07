const express = require("express");
const router = express.Router();
const cycleController = require("../controllers/cycle.controller");

router.get("/prediction", cycleController.getCyclePrediction);

module.exports = router;