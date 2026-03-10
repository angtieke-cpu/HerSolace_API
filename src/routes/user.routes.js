const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const { getUserProfile } = require("../controllers/user.controller");
const { updateUserProfile } = require("../controllers/user.controller");
const { linkUserProfile } = require("../controllers/user.controller");
const { getLinkedProfiles } = require("../controllers/user.controller");

router.post("/user-details", authenticate, updateUserProfile);
router.get("/user-details", authenticate, getUserProfile);
router.post("/link-user", authenticate, linkUserProfile);
router.get("/linked-users", authenticate, getLinkedProfiles);

module.exports = router;
