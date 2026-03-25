const db = require('../db');
const { generateToken } = require('../utils/jwt');
const { sendOtpSms } = require('../utils/twilio');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
// const generateOtp =123456;

exports.signup = async (req, res) => {
  try {
    const { mobileNumber } = req.body;

    if (!mobileNumber) {
      return res.status(400).json({ message: 'Mobile number required' });
    }

    // ✅ STEP 1: Check if already registered in users table
    const existingUser = await db.query(`SELECT id FROM users WHERE mobile_number = $1`, [mobileNumber]);

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User already exists. Please login.',
      });
    }

    // ✅ STEP 2: Continue temp_users logic
    const userResult = await db.query(
      `
      INSERT INTO temp_users (mobile_number)
      VALUES ($1)
      ON CONFLICT (mobile_number) DO NOTHING
      RETURNING id
      `,
      [mobileNumber],
    );

    let userId = userResult.rows[0]?.id;

    if (!userId) {
      const existing = await db.query(`SELECT id FROM temp_users WHERE mobile_number = $1`, [mobileNumber]);
      userId = existing.rows[0].id;
    }

    // ✅ STEP 3: Generate OTP
    // const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // const otp ='123456';
    let otp;
    if (mobileNumber === 1111111111) {
      otp = '123456'; // bypass OTP
    } else {
      otp = Math.floor(100000 + Math.random() * 900000).toString();
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `
      INSERT INTO otp_requests (user_id, purpose, otp, expires_at)
      VALUES ($1, 'signup', $2, $3)
      `,
      [userId, otp, expiresAt],
    );

    // ✅ STEP 4: Send OTP
    // await sendOtpSms(mobileNumber, otp);
    if (mobileNumber !== 1111111111) {
      await sendOtpSms(mobileNumber, otp);
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      userId,
    });
  } catch (error) {
    console.error('Twilio signup OTP error:', error.message);
    res.status(500).json({
      message: 'Failed to send OTP',
    });
  }
};
exports.login = async (req, res) => {
  try {
    const { mobileNumber } = req.body;

    const user = await db.query(`SELECT id FROM users WHERE mobile_number = $1`, [mobileNumber]);

    if (!user.rows.length) {
      return res.status(404).json({
        message: 'User not found, please signup',
      });
    }

    // const otp = generateOtp();
    // const otp =123456;
    let otp;
    if (mobileNumber === '2222222222') {
      otp = 123456; // bypass OTP
    } else {
      otp = generateOtp();
    }
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `
      INSERT INTO otp_requests (user_id, purpose, otp, expires_at)
      VALUES ($1, 'login', $2, $3)
      `,
      [user.rows[0].id, otp, expiresAt],
    );

    console.log('Login OTP (dev):', otp);
    if (mobileNumber !== '2222222222') {
      await sendOtpSms(mobileNumber, otp);
    }
    // await sendOtpSms(mobileNumber, otp);

    res.json({
      success: true,
      message: 'Login OTP sent',
      userId: user.rows[0].id,
    });
  } catch (err) {
    res.status(500).json({ message: 'Login failed' });
  }
};
exports.verifyOtp = async (req, res) => {
  try {
    const { userId, otp, purpose } = req.body;

    if (!userId || !otp || !purpose) {
      return res.status(400).json({
        message: 'Missing verification details',
      });
    }

    const otpResult = await db.query(
      `
      SELECT * FROM otp_requests
      WHERE user_id = $1
        AND otp = $2
        AND purpose = $3
        AND verified = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId, otp, purpose],
    );

    if (!otpResult.rows.length) {
      return res.status(400).json({
        message: 'Invalid or expired OTP',
      });
    }

    // Mark OTP verified
    await db.query(`UPDATE otp_requests SET verified = true WHERE id = $1`, [otpResult.rows[0].id]);

    // Verify user if signup
    if (purpose === 'signup') {
      await db.query(`UPDATE temp_users SET is_verified = true WHERE id = $1`, [userId]);
    }

    // Fetch user
    let userResult;

    if (purpose === 'signup') {
      userResult = await db.query(`SELECT id, mobile_number FROM temp_users WHERE id = $1`, [userId]);
    } else {
      userResult = await db.query(`SELECT id, mobile_number FROM users WHERE id = $1`, [userId]);
    }

    const user = userResult.rows[0];

    // Generate JWT
    const token = generateToken({
      userId: user.id,
      mobileNumber: user.mobile_number,
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        mobileNumber: user.mobile_number,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('OTP verify error:', error);
    res.status(500).json({
      message: 'OTP verification failed',
    });
  }
};
