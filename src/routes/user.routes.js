const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth.middleware");
const { getUserProfile } = require("../controllers/user.controller");
const { updateUserProfile } = require("../controllers/user.controller");
const { linkUserProfile } = require("../controllers/user.controller");
const { getLinkedProfiles } = require("../controllers/user.controller");
const { getUserBymobile } = require("../controllers/user.controller");
const { getTaggedLinkedUsers } = require("../controllers/user.controller");
const { deleteLinkedUser } = require("../controllers/user.controller");
const { updateUserSettings } = require("../controllers/user.controller"); 
const { createUserDeleteRequest } = require("../controllers/user.controller"); 
const { updateProfileLinkRequest } = require("../controllers/user.controller");
const { getHomeNotifications } = require("../controllers/user.controller"); 
const { getUserSymptomConfiguration } = require("../controllers/user.controller"); 
const { getEnabledUserSymptoms } = require("../controllers/user.controller"); 
const { saveUserSymptomConfiguration } = require("../controllers/user.controller"); 
const { getDashboardConfig } = require("../controllers/user.controller"); 
const { saveDashboardConfig } = require("../controllers/user.controller"); 


router.post("/user-details", authenticate, updateUserProfile);
router.get("/user-details", authenticate, getUserProfile);
router.post("/link-user", authenticate, linkUserProfile);
router.get("/linked-users", authenticate, getLinkedProfiles);
router.post("/available-users", authenticate, getUserBymobile);
router.get("/shared-users", authenticate, getTaggedLinkedUsers);
router.post("/unlink-user", authenticate, deleteLinkedUser);
router.post("/user-settings", authenticate, updateUserSettings);
router.post("/user-delete-request", authenticate, createUserDeleteRequest);
router.get("/user-notifications", authenticate, getHomeNotifications);
router.get("/user-config", authenticate, getUserSymptomConfiguration);
router.get("/user-enabled-config", authenticate, getEnabledUserSymptoms);
router.put("/link-user-request", authenticate, updateProfileLinkRequest);
router.post("/user-config", authenticate, saveUserSymptomConfiguration);
router.get("/dashboard-config", authenticate, getDashboardConfig);
router.post("/dashboard-config", authenticate, saveDashboardConfig);

module.exports = router;
