
const db = require("../db");

exports.getUserProfile = async (req, res) => {
  try {

    const userId = req.user.userId;


    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    const result = await db.query(
      `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.mobile_number,
        u.image_base64,
        u.is_verified,
        jd.bleeding_days
      FROM users u
      LEFT JOIN journey_details jd
      ON u.id = jd.user_id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Get user profile error:", error);

    res.status(500).json({
      message: "Failed to fetch user details"
    });
  }
};

exports.updateUserProfile = async (req, res) => {

  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    const {
      name,
      email,
      mobileNumber,
      imageBase64,
      bleedingDays
    } = req.body;


    // 1️⃣ Update users table
    await db.query(
      `
      UPDATE users
      SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        mobile_number = COALESCE($3, mobile_number),
        image_base64 = COALESCE($4, image_base64),
        updated_at = NOW()
      WHERE id = $5
      `,
      [
        name,
        email,
        mobileNumber,
        imageBase64,
        userId
      ]
    );

    // 2️⃣ Update journey_details bleeding_days
    if (bleedingDays !== undefined) {
      await client.query(
        `
        UPDATE journey_details
        SET bleeding_days = $1
        WHERE user_id = $2
        `,
        [bleedingDays, userId]
      );
    }

    res.json({
      success: true,
      message: "User profile updated successfully"
    });

  } catch (error) {

    console.error("Update profile error:", error);

    res.status(500).json({
      message: "Failed to update profile"
    });

  }
};

exports.linkUserProfile = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { mobile_number, relationship } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    // Find user by mobile
    const userResult = await db.query(
      `SELECT id FROM users WHERE mobile_number = $1`,
      [mobile_number]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        message: "User with this mobile number not found"
      });
    }

    const linkedUserId = userResult.rows[0].id;

    // Prevent linking to self
    if (linkedUserId === Number(userId)) {
      return res.status(400).json({
        message: "Cannot link your own profile"
      });
    }

    await db.query(
      `
      INSERT INTO user_profile_links (user_id, linked_user_id, relationship)
      VALUES ($1, $2, $3)
      `,
      [userId, linkedUserId, relationship]
    );

    res.json({
      message: "Profile linked successfully"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getLinkedProfiles = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    const result = await db.query(
      `
  SELECT 
    u.id,
    u.name,
    u.mobile_number,
    l.relationship,
    j.cycle_length_days,
    j.bleeding_days,
    (
      SELECT period_start_date
      FROM user_period_logs upl
      WHERE upl.user_id = u.id
      ORDER BY period_start_date DESC
      LIMIT 1
    ) AS last_period_date
  FROM user_profile_links l
  JOIN users u ON u.id = l.linked_user_id
  LEFT JOIN journey_details j ON j.user_id = u.id
  WHERE l.mobile_number = $1
  `,
      [mobile_number]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getUserBymobile = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }
    const { mobile_number } = req.body;

    const result = await db.query(
      `
  SELECT 
    u.id,
    u.name,
    u.mobile_number,
    l.relationship,
    j.cycle_length_days,
    j.bleeding_days,
    (
      SELECT period_start_date
      FROM user_period_logs upl
      WHERE upl.user_id = u.id
      ORDER BY period_start_date DESC
      LIMIT 1
    ) AS last_period_date
  FROM user_profile_links l
  JOIN users u ON u.id = l.linked_user_id
  LEFT JOIN journey_details j ON j.user_id = u.id
  WHERE l.mobile_number = $1
  `,
      [mobile_number]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};