const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

exports.sendOtpSms = async (mobileNumber, otp) => {
  return client.messages.create({
    body: `Your HerSolace Verification code is ${otp}. It is valid for 5 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: `+91${mobileNumber}`, // change country code if needed
  });
};
