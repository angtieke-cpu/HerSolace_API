
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
    upl.period_date AS last_period_date,
    upl.bleeding_days,
    upl.cycle_length AS cycle_length_days,
    u.anonymous_mode,
    u.notification_mode

  FROM users u

  LEFT JOIN LATERAL (
    SELECT period_date, bleeding_days, cycle_length
    FROM user_period_log
    WHERE user_id = u.id
    ORDER BY period_date DESC
    LIMIT 1
  ) upl ON TRUE

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
      await db.query(
        `
       UPDATE user_period_log
SET bleeding_days = $1
WHERE id = (
  SELECT id
  FROM user_period_log
  WHERE user_id = $2
  ORDER BY period_date DESC
  LIMIT 1
);
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
    const requestedBy = req.user.userId;
    const { mobile_number, relationship } = req.body;

    if (!requestedBy) {
      return res.status(400).json({ message: "userid header required" });
    }

    if (!mobile_number || !relationship) {
      return res.status(400).json({
        message: "mobile_number and relationship required"
      });
    }

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

    if (String(linkedUserId) === String(requestedBy)) {
      return res.status(400).json({
        message: "Cannot link your own profile"
      });
    }

    const existing = await db.query(
      `
      SELECT *
      FROM user_profile_links
      WHERE requested_by = $1
        AND linked_user_id = $2
      LIMIT 1
      `,
      [requestedBy, linkedUserId]
    );

    if (existing.rows.length > 0) {
      const link = existing.rows[0];

      if (link.is_blocked || link.status === "blocked") {
        return res.status(403).json({
          message: "Profile link request blocked after 3 rejections"
        });
      }

      if (link.status === "pending") {
        return res.status(400).json({
          message: "Approval already pending"
        });
      }

      if (link.status === "approved") {
        return res.status(400).json({
          message: "Profile already linked"
        });
      }

      await db.query(
        `
        UPDATE user_profile_links
        SET status = 'pending',
            relationship = $1,
            rejected_at = NULL,
            created_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [relationship, link.id]
      );

      return res.json({
        success: true,
        message: "Profile link request sent again for approval"
      });
    }

    await db.query(
      `
      INSERT INTO user_profile_links
      (
        user_id,
        linked_user_id,
        relationship,
        requested_by,
        status
      )
      VALUES ($1, $2, $3, $4, 'pending')
      `,
      [requestedBy, linkedUserId, relationship, requestedBy]
    );

    return res.json({
      success: true,
      message: "Profile link request sent for approval"
    });

  } catch (error) {
    console.error("Link profile error:", error);
    return res.status(500).json({ message: "Server error" });
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

        uplink.relationship,
        uplink.status,

        upl.period_date AS last_period_date,
        upl.bleeding_days,
        upl.cycle_length

      FROM user_profile_links uplink

      JOIN users u 
        ON u.id = uplink.linked_user_id

      LEFT JOIN user_period_log upl
        ON upl.user_id = u.id
        AND upl.period_date = (
          SELECT MAX(period_date)
          FROM user_period_log
          WHERE user_id = u.id
        )

      WHERE uplink.user_id = $1
        AND uplink.status = 'approved'
        AND uplink.is_blocked = false

      ORDER BY uplink.created_at DESC;
      `,
      [userId]
    );

    return res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error("Get linked profiles error:", error);
    return res.status(500).json({ message: "Server error" });
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
  upl.cycle_length,
  upl.bleeding_days,
  upl.period_date AS last_period_date

FROM users u

LEFT JOIN (
  SELECT DISTINCT ON (user_id)
    user_id,
    cycle_length,
    bleeding_days,
    period_date
  FROM user_period_log
  ORDER BY user_id, period_date DESC
) upl ON upl.user_id = u.id

WHERE u.mobile_number = $1;
  `,
      [mobile_number]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getTaggedLinkedUsers = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required",
      });
    }

    const result = await db.query(
      `
      SELECT 
        u.id AS user_id,
        u.name,
        u.mobile_number
      FROM user_profile_links upl
      JOIN users u 
        ON u.id = upl.user_id
      WHERE upl.linked_user_id = $1
      `,
      [userId]
    );

    // ✅ Mask mobile numbers
    const data = result.rows.map((user) => {
      const mobile = user.mobile_number || "";

      const maskedMobile =
        mobile.length >= 10
          ? mobile.slice(0, 2) + "*****" + mobile.slice(-2)
          : "****";

      return {
        user_id: user.user_id,
        name: user.name,
        mobile_number: maskedMobile,
      };
    });

    res.json(data);

  } catch (error) {
    console.error("Get tagged users error:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
};

exports.deleteLinkedUser = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { linkedUserId } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userid required",
      });
    }

    if (!linkedUserId) {
      return res.status(400).json({
        message: "linkedUserId required",
      });
    }

    const result = await db.query(
      `
      DELETE FROM user_profile_links
      WHERE user_id = $1
      AND linked_user_id = $2
      RETURNING *
      `,
      [linkedUserId,userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        message: "Link not found",
      });
    }

    res.json({
      success: true,
      message: "User unlinked successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Delete link error:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
};
exports.updateUserSettings = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    const {
      anonymous_mode,
      notification_mode
    } = req.body;

    await db.query(
      `
      UPDATE users
      SET
        anonymous_mode = COALESCE($1, anonymous_mode),
        notification_mode = COALESCE($2, notification_mode),
        updated_at = NOW()
      WHERE id = $3
      `,
      [
        anonymous_mode,
        notification_mode,
        userId
      ]
    );

    res.json({
      success: true,
      message: "Settings updated successfully"
    });

  } catch (error) {
    console.error("Update settings error:", error);

    res.status(500).json({
      message: "Failed to update settings"
    });
  }
};

exports.createUserDeleteRequest = async (req, res) => {
  try {
   const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    // 3️⃣ Insert into DB
    await db.query(
      `
      INSERT INTO user_delete_requests (
        user_id,
        request_status
      )
      VALUES ($1, 'PROCESS')
      `,
      [userId]
    );

    // 4️⃣ Response
    res.json({
      success: true,
      message: "Request created successfully"
    });

  } catch (error) {
    console.error("Create request error:", error);

    res.status(500).json({
      message: "Failed to create request"
    });
  }
};
