const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const cycleController = require("../controllers/cycle.controller");

router.get("/prediction",authenticate, cycleController.getCyclePrediction);

module.exports = router;