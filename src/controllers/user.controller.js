
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
exports.getHomeNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid header required"
      });
    }

    const today = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );
    today.setHours(0, 0, 0, 0);

    // 1. Latest period log
    const periodResult = await db.query(
      `
      SELECT period_date, cycle_length, bleeding_days
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date DESC
      LIMIT 1
      `,
      [userId]
    );

    const notifications = [];

    if (periodResult.rows.length > 0) {
      const log = periodResult.rows[0];

      const cycleLength = Number(log.cycle_length) || 28;
      const bleedingDays = Number(log.bleeding_days) || 5;

      const lastPeriodDate = new Date(
        new Date(log.period_date).toLocaleString("en-US", {
          timeZone: "Asia/Kolkata"
        })
      );
      lastPeriodDate.setHours(0, 0, 0, 0);

      const nextPeriodDate = new Date(lastPeriodDate);
      nextPeriodDate.setDate(lastPeriodDate.getDate() + cycleLength);

      const ovulationDate = new Date(lastPeriodDate);
      ovulationDate.setDate(lastPeriodDate.getDate() + cycleLength - 14);

      const fertileStartDate = new Date(ovulationDate);
      fertileStartDate.setDate(ovulationDate.getDate() - 5);

      const fertileEndDate = new Date(ovulationDate);
      fertileEndDate.setDate(ovulationDate.getDate() + 1);

      const daysToPeriod = Math.ceil(
        (nextPeriodDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      const daysToOvulation = Math.ceil(
        (ovulationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      const daysToFertile = Math.ceil(
        (fertileStartDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Period starts within 7 days
      if (daysToPeriod >= 0 && daysToPeriod <= 7) {
        notifications.push({
          type: "period_reminder",
          title: "Period reminder",
          message: `Your period is expected within ${daysToPeriod === 0 ? "today" : daysToPeriod + " days"}. Keep essentials ready and log any symptoms early.`,
          expected_window: `within ${daysToPeriod === 0 ? "today" : daysToPeriod + " days"}`,
          date: nextPeriodDate.toISOString().split("T")[0]
        });
      }

      // Ovulation within 7 days
      if (daysToOvulation >= 0 && daysToOvulation <= 7) {
        notifications.push({
          type: "ovulation_reminder",
          title: "Ovulation reminder",
          message: `Your ovulation is expected within ${daysToOvulation === 0 ? "today" : daysToOvulation + " days"}.`,
          expected_window: `within ${daysToOvulation === 0 ? "today" : daysToOvulation + " days"}`,
          date: ovulationDate.toISOString().split("T")[0]
        });
      }

      // Fertile window starts within 7 days
      if (daysToFertile >= 0 && daysToFertile <= 7) {
        notifications.push({
          type: "fertile_window_reminder",
          title: "Fertile window reminder",
          message: `Your fertile window is expected within ${daysToFertile === 0 ? "today" : daysToFertile + " days"}.`,
          expected_window: `within ${daysToFertile === 0 ? "today" : daysToFertile + " days"}`,
          start_date: fertileStartDate.toISOString().split("T")[0],
          end_date: fertileEndDate.toISOString().split("T")[0]
        });
      }
    }

    // 2. Pending link profile requests
    const linkRequestsResult = await db.query(
  `
  SELECT 
    upl.id AS link_id,
    upl.relationship,
    upl.status,
    upl.reject_count,
    (3 - upl.reject_count) AS remaining_attempts,
    CASE 
      WHEN upl.reject_count >= 2 THEN true
      ELSE false
    END AS will_block_on_reject,
    upl.created_at,

    u.id AS requested_user_id,
    u.name,
    u.mobile_number

  FROM user_profile_links upl

  JOIN users u 
    ON u.id = upl.requested_by

  WHERE upl.linked_user_id = $1
    AND upl.status = 'pending'
    AND upl.is_blocked = false

  ORDER BY upl.created_at DESC
  `,
  [userId]
);

  const allNotifications = [];

// Period notifications
notifications.forEach((item) => {
  allNotifications.push({
    notification_type: "period",
    created_at: item.date || new Date().toISOString(),
    data: item
  });
});

// Link profile requests
linkRequestsResult.rows.forEach((item) => {
  allNotifications.push({
    notification_type: "link_request",
    created_at: item.created_at,
    data: item
  });
});

// Sort latest first
allNotifications.sort(
  (a, b) => new Date(b.created_at) - new Date(a.created_at)
);

return res.json({
  success: true,
  totalNotifications: allNotifications.length,
  linkProfileRequestsCount: linkRequestsResult.rows.length,
  notifications: allNotifications
});

  } catch (error) {
    console.error("Notification API error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
exports.updateProfileLinkRequest = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { link_id, action } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userid header required" });
    }

    if (!link_id || !action) {
      return res.status(400).json({
        message: "link_id and action required"
      });
    }

    if (!["approve", "reject", "block"].includes(action)) {
      return res.status(400).json({
        message: "Invalid action. Use approve, reject, or block"
      });
    }

    const requestResult = await db.query(
      `
      SELECT *
      FROM user_profile_links
      WHERE id = $1
        AND linked_user_id = $2
        AND status = 'pending'
        AND is_blocked = false
      `,
      [link_id, userId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({
        message: "Pending profile request not found"
      });
    }

    const link = requestResult.rows[0];

    if (action === "approve") {
      await db.query(
        `
        UPDATE user_profile_links
        SET status = 'approved',
            approved_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [link_id]
      );

      return res.json({
        success: true,
        action: "approve",
        message: "Profile request approved"
      });
    }

    if (action === "block") {
      await db.query(
        `
        UPDATE user_profile_links
        SET status = 'blocked',
            is_blocked = true,
            rejected_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [link_id]
      );

      return res.json({
        success: true,
        action: "block",
        blocked: true,
        message: "Profile request blocked"
      });
    }

    if (action === "reject") {
      const newRejectCount = Number(link.reject_count || 0) + 1;

      if (newRejectCount >= 3) {
        await db.query(
          `
          UPDATE user_profile_links
          SET status = 'blocked',
              reject_count = $1,
              is_blocked = true,
              rejected_at = CURRENT_TIMESTAMP
          WHERE id = $2
          `,
          [newRejectCount, link_id]
        );

        return res.json({
          success: true,
          action: "reject",
          blocked: true,
          reject_count: newRejectCount,
          message: "Request rejected 3 times. Profile request blocked."
        });
      }

      await db.query(
        `
        UPDATE user_profile_links
        SET status = 'rejected',
            reject_count = $1,
            rejected_at = CURRENT_TIMESTAMP
        WHERE id = $2
        `,
        [newRejectCount, link_id]
      );

      return res.json({
        success: true,
        action: "reject",
        blocked: false,
        reject_count: newRejectCount,
        remaining_attempts: 3 - newRejectCount,
        message: "Profile request rejected"
      });
    }

  } catch (error) {
    console.error("Update profile link request error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};

exports.getUserSymptomConfiguration = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid required"
      });
    }

    const result = await db.query(
      `
      SELECT
        sc.id,
        sc.source_sheet,
        sc.phase,
        sc.category,
        sc.symptom,
        sc.priority,
        sc.requirement,
        sc.is_active,

        CASE
          WHEN sc.requirement = 'Mandatory'
            THEN true
          ELSE COALESCE(
            usp.is_selected,
            false
          )
        END AS is_selected,

        CASE
          WHEN sc.requirement = 'Mandatory'
            THEN false
          ELSE true
        END AS is_editable

      FROM symptom_config sc

      LEFT JOIN user_symptom_preferences usp
        ON usp.symptom_config_id = sc.id
       AND usp.user_id = $1

      WHERE sc.is_active = true

      ORDER BY
        CASE
          WHEN sc.requirement = 'Mandatory'
            THEN 1
          ELSE 2
        END,
        sc.phase NULLS LAST,
        sc.category NULLS LAST,
        sc.priority NULLS LAST,
        sc.symptom ASC
      `,
      [userId]
    );

    const allSymptoms = result.rows.map((row) => ({
      id: row.id,
      sourceSheet: row.source_sheet,
      phase: row.phase,
      category: row.category,
      symptom: row.symptom,
      priority: row.priority,
      requirement: row.requirement,

      isMandatory:
        row.requirement === "Mandatory",

      isOptional:
        row.requirement === "Optional",

      isSelected:
        Boolean(row.is_selected),

      isEditable:
        Boolean(row.is_editable)
    }));

    const mandatorySymptoms =
      allSymptoms.filter(
        (item) => item.isMandatory
      );

    const optionalSymptoms =
      allSymptoms.filter(
        (item) => item.isOptional
      );

    const selectedOptionalSymptoms =
      optionalSymptoms.filter(
        (item) => item.isSelected
      );

    const unselectedOptionalSymptoms =
      optionalSymptoms.filter(
        (item) => !item.isSelected
      );

    const selectedSymptoms =
      allSymptoms.filter(
        (item) => item.isSelected
      );

    /*
     * Optional grouping for easier frontend rendering.
     */
    const groupedByPhase = allSymptoms.reduce(
      (groups, symptom) => {
        const phase =
          symptom.phase || "General";

        if (!groups[phase]) {
          groups[phase] = {
            phase,
            mandatory: [],
            optional: []
          };
        }

        if (symptom.isMandatory) {
          groups[phase].mandatory.push(symptom);
        } else {
          groups[phase].optional.push(symptom);
        }

        return groups;
      },
      {}
    );

    return res.json({
      success: true,

      data: {
        counts: {
          total: allSymptoms.length,

          mandatory:
            mandatorySymptoms.length,

          optional:
            optionalSymptoms.length,

          selectedOptional:
            selectedOptionalSymptoms.length,

          unselectedOptional:
            unselectedOptionalSymptoms.length,

          totalSelected:
            selectedSymptoms.length
        },

        mandatorySymptoms,

        optionalSymptoms,

        selectedOptionalSymptoms,

        unselectedOptionalSymptoms,

        selectedSymptoms,

        allSymptoms,

        groupedByPhase:
          Object.values(groupedByPhase)
      }
    });
  } catch (error) {
    console.error(
      "getUserSymptomConfiguration error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch symptom configuration"
    });
  }
};
