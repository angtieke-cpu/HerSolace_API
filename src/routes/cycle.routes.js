const express = require("express");
const router = express.Router();
const cycleController = require("../controllers/cycleController");

router.post("/prediction", cycleController.getCyclePrediction);

module.exports = router;