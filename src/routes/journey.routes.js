const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const { saveJourneyDetails } = require("../controllers/journey.controller");
const { saveJourneyDetails } = require("../controllers/journey.controller");

router.post("/details", authenticate, saveJourneyDetails);
// router.get("/get", authenticate, get);

module.exports = router;
