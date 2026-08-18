const express = require("express");
const router = express.Router();

const {
  signup,
  login,
  verifyOtp,
  facebookLogin,
  googleLogin,
  registerPushToken

} = require("../controllers/auth.controller");

router.post("/signup", signup);
router.post("/login", login);
router.post("/verify-otp", verifyOtp);
router.post(
  "/google",
  googleLogin
);
router.post(
  "/facebook",
  facebookLogin
);
router.post(
  "/register-token",
  registerPushToken
);

module.exports = router;
