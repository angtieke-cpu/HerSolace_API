
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
    u.user_number,
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
    const requestedBy = req.user?.userId;
    const { mobile_number, relationship } = req.body;

    if (!requestedBy) {
      return res.status(400).json({
        success: false,
        message: "userid header required"
      });
    }

    if (!mobile_number || !relationship) {
      return res.status(400).json({
        success: false,
        message: "mobile_number and relationship required"
      });
    }

    const searchValue = String(mobile_number).trim();

    // Find the person whose profile is being requested.
    // mobile_number is kept as the common frontend field.
    const userResult = await db.query(
      `
      SELECT id
      FROM users
      WHERE
        mobile_number::TEXT = $1
        OR email = $1
        OR user_number::TEXT = $1
      LIMIT 1
      `,
      [searchValue]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const linkedUserId = userResult.rows[0].id;

    // Cannot request your own profile
    if (String(linkedUserId) === String(requestedBy)) {
      return res.status(400).json({
        success: false,
        message: "Cannot link your own profile"
      });
    }

    // Check existing request
    const existing = await db.query(
      `
      SELECT *
      FROM user_profile_links
      WHERE user_id = $1
        AND linked_user_id = $2
      LIMIT 1
      `,
      [requestedBy, linkedUserId]
    );

    if (existing.rows.length > 0) {
      const link = existing.rows[0];

      if (link.is_blocked || link.status === "blocked") {
        return res.status(403).json({
          success: false,
          message: "Profile link request blocked after 3 rejections"
        });
      }

      if (link.status === "pending") {
        return res.status(400).json({
          success: false,
          message: "Approval already pending"
        });
      }

      if (link.status === "approved") {
        return res.status(400).json({
          success: false,
          message: "Profile already linked"
        });
      }

      // Re-send rejected request
      await db.query(
        `
        UPDATE user_profile_links
        SET
          status = 'pending',
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

    // Create new request
    await db.query(
      `
      INSERT INTO user_profile_links
      (
        user_id,
        linked_user_id,
        relationship,
        requested_by,
        status,
        is_blocked
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $1,
        'pending',
        false
      )
      `,
      [
        requestedBy,
        linkedUserId,
        relationship
      ]
    );

    return res.json({
      success: true,
      message: "Profile link request sent for approval"
    });

  } catch (error) {
    console.error("Link profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};
exports.getLinkedProfiles = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid header required"
      });
    }

    const result = await db.query(
      `
      SELECT
        u.id,
        u.name,
        u.mobile_number,
        u.anonymous_mode,

        uplink.relationship,
        uplink.status,

        latest.period_date AS last_period_date,
        latest.bleeding_days,
        latest.cycle_length,

        COALESCE(recent.recent_cycles, '[]'::jsonb) AS recent_cycles

      FROM user_profile_links uplink

      JOIN users u
        ON u.id = uplink.linked_user_id

      -- Latest period log
      LEFT JOIN LATERAL (
        SELECT
          period_date,
          bleeding_days,
          cycle_length
        FROM user_period_log
        WHERE user_id = u.id
        ORDER BY period_date DESC
        LIMIT 1
      ) latest ON true

      -- ALL period logs
      LEFT JOIN LATERAL (
        SELECT
          jsonb_agg(
            jsonb_build_object(
              'periodDate', period_date,
              'bleedingDays', bleeding_days,
              'cycleLength', cycle_length
            )
            ORDER BY period_date DESC
          ) AS recent_cycles
        FROM user_period_log
        WHERE user_id = u.id
      ) recent ON true

      WHERE uplink.user_id = $1
        AND uplink.status = 'approved'
        AND uplink.is_blocked = false

      ORDER BY uplink.created_at DESC;
      `,
      [userId]
    );

    const data = result.rows.map(row => {
      const isAnonymous = row.anonymous_mode === true;

      return {
        id: row.id,

        name: isAnonymous
          ? "****"
          : row.name,

        mobile_number: isAnonymous
          ? "**********"
          : row.mobile_number,

        relationship: row.relationship,
        status: row.status,

        lastPeriod: row.last_period_date,
        bleedingDays: row.bleeding_days,
        cycleLength: row.cycle_length,

        recentCycles: row.recent_cycles || []
      };
    });

    return res.json({
      success: true,
      count: data.length,
      data
    });

  } catch (error) {
    console.error("Get linked profiles error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
};


exports.getUserBymobile = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid header required"
      });
    }

    // Keep mobile_number as the common request field
    const { mobile_number } = req.body;

    if (
      mobile_number === undefined ||
      mobile_number === null ||
      mobile_number === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "mobile_number is required"
      });
    }

    const searchValue = String(mobile_number).trim();

    const result = await db.query(
      `
      SELECT 
        u.id,
        u.user_number,
        u.name,
        u.mobile_number,
        u.email,
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

      WHERE
        u.mobile_number::TEXT = $1
        OR u.email = $1
        OR u.user_number::TEXT = $1

      LIMIT 1;
      `,
      [searchValue]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    return res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("getUserBymobile error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
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
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid header required"
      });
    }

    // Get current date normalized to start of day (Asia/Kolkata context)
    const now = new Date();
    const today = new Date(
      now.toLocaleDateString("en-US", { timeZone: "Asia/Kolkata" })
    );

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

    const derivedNotifications = [];

    if (periodResult.rows.length > 0) {
      const log = periodResult.rows[0];
      const cycleLength = Number(log.cycle_length) || 28;

      const lastPeriodDate = new Date(
        new Date(log.period_date).toLocaleDateString("en-US", {
          timeZone: "Asia/Kolkata"
        })
      );

      const nextPeriodDate = new Date(lastPeriodDate);
      nextPeriodDate.setDate(lastPeriodDate.getDate() + cycleLength);

      const ovulationDate = new Date(lastPeriodDate);
      ovulationDate.setDate(lastPeriodDate.getDate() + cycleLength - 14);

      const fertileStartDate = new Date(ovulationDate);
      fertileStartDate.setDate(ovulationDate.getDate() - 5);

      const fertileEndDate = new Date(ovulationDate);
      fertileEndDate.setDate(ovulationDate.getDate() + 1);

      // Day differences calculated relative to normalized today
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const daysToPeriod = Math.ceil((nextPeriodDate - today) / MS_PER_DAY);
      const daysToOvulation = Math.ceil((ovulationDate - today) / MS_PER_DAY);
      const daysToFertile = Math.ceil((fertileStartDate - today) / MS_PER_DAY);

      if (daysToPeriod >= 0 && daysToPeriod <= 7) {
        const dateStr = nextPeriodDate.toISOString().split("T")[0];
        derivedNotifications.push({
          notification_type: "period_reminder",
          notification_key: `period_${dateStr}`,
          title: "Period reminder",
          message: `Your period is expected within ${
            daysToPeriod === 0 ? "today" : daysToPeriod + " days"
          }. Keep essentials ready and log any symptoms early.`,
          notification_date: dateStr,
          payload: {
            expected_window: daysToPeriod === 0 ? "today" : `${daysToPeriod} days`,
            date: dateStr
          }
        });
      }

      if (daysToOvulation >= 0 && daysToOvulation <= 7) {
        const dateStr = ovulationDate.toISOString().split("T")[0];
        derivedNotifications.push({
          notification_type: "ovulation_reminder",
          notification_key: `ovulation_${dateStr}`,
          title: "Ovulation reminder",
          message: `Your ovulation is expected within ${
            daysToOvulation === 0 ? "today" : daysToOvulation + " days"
          }.`,
          notification_date: dateStr,
          payload: {
            expected_window: daysToOvulation === 0 ? "today" : `${daysToOvulation} days`,
            date: dateStr
          }
        });
      }

      if (daysToFertile >= 0 && daysToFertile <= 7) {
        const startDateStr = fertileStartDate.toISOString().split("T")[0];
        const endDateStr = fertileEndDate.toISOString().split("T")[0];
        derivedNotifications.push({
          notification_type: "fertile_window_reminder",
          notification_key: `fertile_${startDateStr}`,
          title: "Fertile window reminder",
          message: `Your fertile window is expected within ${
            daysToFertile === 0 ? "today" : daysToFertile + " days"
          }.`,
          notification_date: startDateStr,
          payload: {
            expected_window: daysToFertile === 0 ? "today" : `${daysToFertile} days`,
            start_date: startDateStr,
            end_date: endDateStr
          }
        });
      }
    }

    // ============================
    // Link Profile Requests
    // ============================
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
      JOIN users u ON u.id = upl.requested_by
      WHERE upl.linked_user_id = $1
        AND upl.status = 'pending'
        AND upl.is_blocked = false
      ORDER BY upl.created_at DESC
      `,
      [userId]
    );

    // ==========================================
    // Save Derived Period Notifications (Parallel)
    // ==========================================
    const periodNotificationPromises = derivedNotifications.map((item) =>
      db.query(
        `
        INSERT INTO user_notification_tracker
        (user_id, notification_type, notification_key, title, message, payload, notification_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, notification_key)
        DO NOTHING
        `,
        [
          userId,
          item.notification_type,
          item.notification_key,
          item.title,
          item.message,
          JSON.stringify(item.payload),
          item.notification_date
        ]
      )
    );

    // ==========================================
    // Save Link Request Notifications (Parallel)
    // ==========================================
    const linkNotificationPromises = linkRequestsResult.rows.map((request) =>
      db.query(
        `
        INSERT INTO user_notification_tracker
        (user_id, notification_type, notification_key, title, message, payload, notification_date)
        VALUES ($1, 'link_request', $2, $3, $4, $5, CURRENT_DATE)
        ON CONFLICT (user_id, notification_key)
        DO NOTHING
        `,
        [
          userId,
          `link_request_${request.link_id}`,
          "Profile Link Request",
          `${request.name} sent you a profile link request.`,
          JSON.stringify(request)
        ]
      )
    );

    // Execute database operations in parallel
    await Promise.all([...periodNotificationPromises, ...linkNotificationPromises]);

    // ==========================================
    // Fetch Only Unread Notifications
    // ==========================================
    const notificationResult = await db.query(
      `
      SELECT
        id,
        notification_type,
        title,
        message,
        payload,
        notification_date,
        is_viewed,
        created_at
      FROM user_notification_tracker
      WHERE user_id = $1
        AND is_viewed = false
      ORDER BY created_at DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      totalNotifications: notificationResult.rows.length,
      notifications: notificationResult.rows
    });
  } catch (error) {
    console.error("Error in getHomeNotifications:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
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

exports.getEnabledUserSymptoms = async (req, res) => {
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

        CASE
          WHEN sc.requirement = 'Mandatory'
            THEN true
          ELSE COALESCE(
            usp.is_selected,
            false
          )
        END AS is_selected

      FROM symptom_config sc

      LEFT JOIN user_symptom_preferences usp
        ON usp.symptom_config_id = sc.id
       AND usp.user_id = $1

      WHERE sc.is_active = true

        AND (
          sc.requirement = 'Mandatory'

          OR COALESCE(
            usp.is_selected,
            false
          ) = true
        )

      ORDER BY
        sc.phase NULLS LAST,
        sc.category NULLS LAST,

        CASE
          WHEN sc.requirement = 'Mandatory'
            THEN 1
          ELSE 2
        END,

        sc.priority NULLS LAST,
        sc.symptom ASC
      `,
      [userId]
    );

    const symptoms =
      result.rows.map((row) => ({
        id: row.id,
        sourceSheet: row.source_sheet,
        phase: row.phase,
        category: row.category,
        symptom: row.symptom,
        priority: row.priority,
        requirement: row.requirement,
        isMandatory:
          row.requirement === "Mandatory",
        isSelected: true
      }));

    const groupedByPhase =
      symptoms.reduce(
        (groups, symptom) => {
          const phase =
            symptom.phase || "General";

          if (!groups[phase]) {
            groups[phase] = [];
          }

          groups[phase].push(symptom);

          return groups;
        },
        {}
      );

    return res.json({
      success: true,

      data: {
        count: symptoms.length,
        symptoms,

        groupedByPhase:
          Object.entries(groupedByPhase)
            .map(([phase, items]) => ({
              phase,
              symptoms: items
            }))
      }
    });
  } catch (error) {
    console.error(
      "getEnabledUserSymptoms error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch enabled symptoms"
    });
  }
};

exports.saveUserSymptomConfiguration = async (req, res) => {
  const client = await db.connect();

  try {
    const userId = req.user?.userId;
    const { symptoms } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid required"
      });
    }

    if (!Array.isArray(symptoms)) {
      return res.status(400).json({
        success: false,
        message: "symptoms must be an array"
      });
    }

    if (symptoms.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one symptom is required"
      });
    }

    /*
     * Validate request object structure.
     */
    const invalidItems = symptoms.filter(
      (item) =>
        !item ||
        !item.symptomId ||
        typeof item.isSelected !== "boolean"
    );

    if (invalidItems.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Each symptom must contain symptomId and boolean isSelected"
      });
    }

    /*
     * Remove duplicate symptom IDs.
     * When the same ID is supplied more than once,
     * the last value is used.
     */
    const symptomsMap = new Map();

    for (const item of symptoms) {
      const symptomId = String(
        item.symptomId
      ).trim();

      if (!symptomId) {
        return res.status(400).json({
          success: false,
          message: "Invalid symptomId"
        });
      }

      symptomsMap.set(symptomId, {
        symptomId,
        isSelected: item.isSelected
      });
    }

    const uniqueSymptoms = Array.from(
      symptomsMap.values()
    );

    const symptomIds = uniqueSymptoms.map(
      (item) => item.symptomId
    );

    const selectedValues = uniqueSymptoms.map(
      (item) => item.isSelected
    );

    /*
     * Validate all IDs before updating.
     *
     * Only active optional symptoms can be modified.
     * Mandatory symptoms cannot be changed.
     */
    const validResult = await client.query(
      `
      SELECT
        id,
        symptom,
        requirement,
        is_active
      FROM symptom_config
      WHERE id = ANY($1::uuid[])
      `,
      [symptomIds]
    );

    const existingIds = new Set(
      validResult.rows.map((row) =>
        String(row.id)
      )
    );

    const invalidSymptomIds =
      symptomIds.filter(
        (id) => !existingIds.has(id)
      );

    if (invalidSymptomIds.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "One or more symptom IDs do not exist",
        invalidSymptomIds
      });
    }

    const inactiveSymptoms =
      validResult.rows.filter(
        (row) => !row.is_active
      );

    if (inactiveSymptoms.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Inactive symptoms cannot be updated",
        inactiveSymptoms:
          inactiveSymptoms.map((row) => ({
            symptomId: row.id,
            symptom: row.symptom
          }))
      });
    }

    const mandatorySymptoms =
      validResult.rows.filter(
        (row) =>
          row.requirement === "Mandatory"
      );

    if (mandatorySymptoms.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Mandatory symptoms cannot be changed",
        mandatorySymptoms:
          mandatorySymptoms.map((row) => ({
            symptomId: row.id,
            symptom: row.symptom
          }))
      });
    }

    await client.query("BEGIN");

    /*
     * Insert or update all provided symptoms.
     *
     * This only changes the symptoms included in the request.
     * Other user preferences remain unchanged.
     */
    const updateResult = await client.query(
      `
      INSERT INTO user_symptom_preferences (
        user_id,
        symptom_config_id,
        is_selected,
        created_at,
        updated_at
      )

      SELECT
        $1,
        symptom_data.symptom_id,
        symptom_data.is_selected,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP

      FROM UNNEST(
        $2::uuid[],
        $3::boolean[]
      ) AS symptom_data(
        symptom_id,
        is_selected
      )

      ON CONFLICT (
        user_id,
        symptom_config_id
      )

      DO UPDATE SET
        is_selected =
          EXCLUDED.is_selected,

        updated_at =
          CURRENT_TIMESTAMP

      RETURNING
        symptom_config_id,
        is_selected,
        created_at,
        updated_at
      `,
      [
        userId,
        symptomIds,
        selectedValues
      ]
    );

    await client.query("COMMIT");

    const selectedCount =
      updateResult.rows.filter(
        (row) => row.is_selected
      ).length;

    const unselectedCount =
      updateResult.rows.filter(
        (row) => !row.is_selected
      ).length;

    return res.json({
      success: true,
      message:
        "Symptom configuration saved successfully",

      data: {
        updatedCount:
          updateResult.rows.length,

        selectedCount,

        unselectedCount,

        symptoms:
          updateResult.rows.map((row) => ({
            symptomId:
              row.symptom_config_id,

            isSelected:
              row.is_selected,

            updatedAt:
              row.updated_at
          }))
      }
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(
        "Preference rollback error:",
        rollbackError
      );
    }

    console.error(
      "saveUserSymptomConfiguration error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to save symptom configuration",

      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined
    });
  } finally {
    client.release();
  }
};

exports.getDashboardConfig = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing"
      });
    }

    const result = await db.query(
      `
      INSERT INTO user_dashboard_config (
        user_id
      )
      VALUES ($1)

      ON CONFLICT (user_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id

      RETURNING
        id,
        user_id AS "userId",
        graph_view AS "graphView",
        insights,
        energy_mood AS "energyMood",
        reminder,
        period_history AS "periodHistory",
        shared_profile AS "sharedProfile",
        phase_based_theme AS "phaseBasedTheme",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: "Dashboard configuration fetched successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Get dashboard configuration error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard configuration"
    });
  }
};
exports.saveDashboardConfig = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const {
      graphView,
      insights,
      energyMood,
      reminder,
      periodHistory,
      sharedProfile,
      phaseBasedTheme
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing"
      });
    }

    const fields = {
      graphView,
      insights,
      energyMood,
      reminder,
      periodHistory,
      sharedProfile,
      phaseBasedTheme
    };

    for (const [fieldName, value] of Object.entries(fields)) {
      if (typeof value !== "boolean") {
        return res.status(400).json({
          success: false,
          message: `${fieldName} must be a boolean`
        });
      }
    }

    const result = await db.query(
      `
      INSERT INTO user_dashboard_config (
        user_id,
        graph_view,
        insights,
        energy_mood,
        reminder,
        period_history,
        shared_profile,
        phase_based_theme
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )

      ON CONFLICT (user_id)
      DO UPDATE SET
        graph_view = EXCLUDED.graph_view,
        insights = EXCLUDED.insights,
        energy_mood = EXCLUDED.energy_mood,
        reminder = EXCLUDED.reminder,
        period_history = EXCLUDED.period_history,
        shared_profile = EXCLUDED.shared_profile,
        phase_based_theme =  EXCLUDED.phase_based_theme,
        updated_at = NOW()

      RETURNING
        id,
        user_id AS "userId",
        graph_view AS "graphView",
        insights,
        energy_mood AS "energyMood",
        reminder,
        period_history AS "periodHistory",
        shared_profile AS "sharedProfile",
        phase_based_theme  AS "phaseBasedTheme",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [
        userId,
        graphView,
        insights,
        energyMood,
        reminder,
        periodHistory,
        sharedProfile,
        phaseBasedTheme
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Dashboard configuration saved successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Save dashboard configuration error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save dashboard configuration"
    });
  }
};
exports.markNotificationViewed = async (req, res) => {

    try {

        const userId = req.user.userId;

        const { notificationId } = req.body;

        await db.query(
            `
            UPDATE user_notification_tracker
            SET
                is_viewed = true,
                viewed_at = NOW()
            WHERE
                id=$1
            AND
                user_id=$2
            `,
            [notificationId, userId]
        );

        return res.json({
            success: true,
            message: "Notification marked as viewed."
        });

    } catch (err) {

        console.log(err);

        return res.status(500).json({
            success:false,
            message:"Server error"
        });

    }

};
