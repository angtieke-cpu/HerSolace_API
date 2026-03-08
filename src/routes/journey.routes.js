const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const { saveJourneyDetails } = require("../controllers/journey.controller");
const { getPreviousCycleDetails } = require("../controllers/journey.controller");

router.post("/details", authenticate, saveJourneyDetails);
router.get("/cycle-details", authenticate, getPreviousCycleDetails);

module.exports = router;
