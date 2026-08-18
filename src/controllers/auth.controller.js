const db = require('../db');
const { generateToken } = require('../utils/jwt');
const { sendOtpSms } = require('../utils/twilio');
const { OAuth2Client } = require("google-auth-library");
const { Expo } = require("expo-server-sdk");

const expo = new Expo();

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

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

    if (existingUser.rows.length > 0 && mobileNumber !== 1111111111) {
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
    if (mobileNumber === 2222222222) {
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
    if (mobileNumber !== 2222222222) {
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

exports.googleLogin = async (req, res) => {
  const client = await db.connect();

  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google ID token is required"
      });
    }

    // 1. Verify Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google token"
      });
    }

    const googleUserId = payload.sub;
    const email = payload.email || null;
    const name = payload.name || null;
    const picture = payload.picture || null;

    if (!googleUserId) {
      return res.status(401).json({
        success: false,
        message: "Google user ID not found"
      });
    }

    await client.query("BEGIN");

    // 2. Check whether Google account is already linked
    const providerResult = await client.query(
      `
      SELECT
        uap.user_id,
        u.id,
        u.name,
        u.email,
        u.mobile_number
      FROM user_auth_providers uap
      JOIN users u
        ON u.id = uap.user_id
      WHERE uap.provider = 'google'
        AND uap.provider_user_id = $1
      LIMIT 1
      `,
      [googleUserId]
    );

    let user;

    if (providerResult.rows.length > 0) {
      // Existing Google user
      user = providerResult.rows[0];
    } else {

      // 3. Check whether email already belongs to a user
      let existingUser = null;

      if (email) {
        const emailResult = await client.query(
          `
          SELECT
            id,
            name,
            email,
            mobile_number
          FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [email]
        );

        if (emailResult.rows.length > 0) {
          existingUser = emailResult.rows[0];
        }
      }

      if (existingUser) {
        // Existing OTP account
        user = existingUser;
      } else {
        // 4. Create new user
        const userResult = await client.query(
          `
          INSERT INTO users (
            name,
            email
          )
          VALUES ($1, $2)
          RETURNING
            id,
            name,
            email,
            mobile_number
          `,
          [name, email]
        );

        user = userResult.rows[0];
      }

      // 5. Link Google account
      await client.query(
        `
        INSERT INTO user_auth_providers (
          user_id,
          provider,
          provider_user_id,
          email
        )
        VALUES ($1, 'google', $2, $3)
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          user.id,
          googleUserId,
          email
        ]
      );
    }

    await client.query("COMMIT");

    // 6. Generate your existing HerSolace JWT
    const token = generateToken({
      userId: user.id
    });

    return res.json({
      success: true,
      message: "Google login successful",
      userId: user.id,
      token,
      isNewUser: !providerResult.rows.length,
      user
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Google login error:", error);

    return res.status(500).json({
      success: false,
      message: "Google login failed"
    });

  } finally {
    client.release();
  }
};

exports.facebookLogin = async (req, res) => {
  const client = await db.connect();

  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        success: false,
        message: "Facebook access token is required"
      });
    }

    // 1. Verify Facebook token and get user information
    const debugUrl =
      `https://graph.facebook.com/debug_token` +
      `?input_token=${encodeURIComponent(accessToken)}` +
      `&access_token=${encodeURIComponent(
        `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`
      )}`;

    const debugResponse = await fetch(debugUrl);

    if (!debugResponse.ok) {
      return res.status(401).json({
        success: false,
        message: "Unable to verify Facebook token"
      });
    }

    const debugData = await debugResponse.json();

    if (
      !debugData?.data?.is_valid ||
      debugData?.data?.app_id !== process.env.FACEBOOK_APP_ID
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid Facebook access token"
      });
    }

    const facebookUserId = debugData.data.user_id;

    if (!facebookUserId) {
      return res.status(401).json({
        success: false,
        message: "Facebook user ID not found"
      });
    }

    // 2. Get Facebook profile
    const profileUrl =
      `https://graph.facebook.com/me` +
      `?fields=id,name,email,picture.type(large)` +
      `&access_token=${encodeURIComponent(accessToken)}`;

    const profileResponse = await fetch(profileUrl);

    if (!profileResponse.ok) {
      return res.status(401).json({
        success: false,
        message: "Unable to fetch Facebook profile"
      });
    }

    const profile = await profileResponse.json();

    const name = profile.name || null;
    const email = profile.email || null;

    await client.query("BEGIN");

    // 3. Check existing Facebook account
    const providerResult = await client.query(
      `
      SELECT
        uap.user_id,
        u.id,
        u.name,
        u.email,
        u.mobile_number
      FROM user_auth_providers uap
      JOIN users u
        ON u.id = uap.user_id
      WHERE uap.provider = 'facebook'
        AND uap.provider_user_id = $1
      LIMIT 1
      `,
      [facebookUserId]
    );

    let user;

    if (providerResult.rows.length > 0) {

      // Existing Facebook user
      user = providerResult.rows[0];

    } else {

      // 4. Check existing account using email
      let existingUser = null;

      if (email) {
        const emailResult = await client.query(
          `
          SELECT
            id,
            name,
            email,
            mobile_number
          FROM users
          WHERE LOWER(email) = LOWER($1)
          LIMIT 1
          `,
          [email]
        );

        if (emailResult.rows.length > 0) {
          existingUser = emailResult.rows[0];
        }
      }

      if (existingUser) {

        // Existing OTP/Google account
        user = existingUser;

      } else {

        // 5. Create new user
        const userResult = await client.query(
          `
          INSERT INTO users (
            name,
            email
          )
          VALUES ($1, $2)
          RETURNING
            id,
            name,
            email,
            mobile_number
          `,
          [name, email]
        );

        user = userResult.rows[0];
      }

      // 6. Link Facebook account
      await client.query(
        `
        INSERT INTO user_auth_providers (
          user_id,
          provider,
          provider_user_id,
          email
        )
        VALUES ($1, 'facebook', $2, $3)
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE SET
          email = EXCLUDED.email,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          user.id,
          facebookUserId,
          email
        ]
      );
    }

    await client.query("COMMIT");

    // 7. Generate HerSolace JWT
    const token = generateToken({
      userId: user.id
    });

    return res.json({
      success: true,
      message: "Facebook login successful",
      userId: user.id,
      token,
      isNewUser: !providerResult.rows.length,
      user
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Facebook login error:", error);

    return res.status(500).json({
      success: false,
      message: "Facebook login failed"
    });

  } finally {
    client.release();
  }
};
exports.sendPushNotification = async (pushToken, title, body, data = {}) => {
  try {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.log("Invalid Expo push token:", pushToken);
      return;
    }

    const messages = [
      {
        to: pushToken,
        sound: "default",
        title,
        body,
        data,
      },
    ];

    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log("Notification tickets:", tickets);
    }
  } catch (error) {
    console.error("Push notification error:", error);
  }
};
exports.registerPushToken = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const {
      pushToken,
      platform
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID required"
      });
    }

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        message: "Push token required"
      });
    }

    if (!["android", "ios"].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: "Platform must be android or ios"
      });
    }

    // Verify that the user exists
    const userResult = await db.query(
      `
      SELECT id
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Insert token or update existing token
    const result = await db.query(
      `
      INSERT INTO user_push_tokens (
        user_id,
        push_token,
        platform,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, push_token)
      DO UPDATE SET
        platform = EXCLUDED.platform,
        is_active = TRUE,
        updated_at = CURRENT_TIMESTAMP
      RETURNING
        id,
        user_id AS "userId",
        push_token AS "pushToken",
        platform,
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [userId, pushToken, platform]
    );

    return res.status(200).json({
      success: true,
      message: "Push token registered successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Register push token error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to register push token"
    });
  }
};
