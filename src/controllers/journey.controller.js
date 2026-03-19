const db = require("../db");
const { generateToken } = require("../utils/jwt");

exports.saveJourneyDetails = async (req, res) => {
  const client = await db.connect();

  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId required",
      });
    }

    const {
      name,
      ageGroup,
      dateOfBirth,
      cycleLengthDays,
      bleedingDays,
      symptoms,
      lastPeriodDate,
      healthGoals,
      diagnosedConditions,
      trackingSymptoms,
    } = req.body;

    if (
      !name ||
      !ageGroup ||
      !dateOfBirth ||
      !cycleLengthDays ||
      !bleedingDays ||
      !lastPeriodDate
    ) {
      return res.status(400).json({
        message: "Missing journey details",
      });
    }

    await client.query("BEGIN");

    // 1️⃣ Move user from temp_users → users
    await client.query(
      `
      INSERT INTO users (id, mobile_number, is_verified, name, email, image_base64)
      SELECT id, mobile_number, is_verified, $2, email, image_base64
      FROM temp_users
      WHERE id = $1
      `,
      [userId, name]
    );

    // 2️⃣ Remove from temp_users
    await client.query(
      `
      DELETE FROM temp_users
      WHERE id = $1
      `,
      [userId]
    );

    // 3️⃣ Insert journey details
    const result = await client.query(
      `
      INSERT INTO journey_details (
        user_id,
        age_group,
        date_of_birth,
        cycle_length_days,
        bleeding_days,
        symptoms,
        last_period_date,
        health_goals,
        diagnosed_conditions,
        tracking_symptoms
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
      `,
      [
        userId,
        ageGroup,
        dateOfBirth,
        cycleLengthDays,
        bleedingDays,
        symptoms || [],
        lastPeriodDate,
        healthGoals || [],
        diagnosedConditions || [],
        trackingSymptoms || [],
      ]
    );

    // 4️⃣ Insert first period log
    await client.query(
      `
      INSERT INTO user_period_log (
        user_id,
        period_date,
        bleeding_days,
        cycle_length
      )
      VALUES ($1,$2)
      `,
      [userId, lastPeriodDate,cycleLengthDays,bleedingDays]
    );

     const userResult = await client.query(
      `
      SELECT id, mobile_number, name
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    const user = userResult.rows[0];


    await client.query("COMMIT");
    const token = generateToken({
      userId: user.id,
      mobileNumber: user.mobile_number,
    });

    res.status(201).json({
      success: true,
      token,
      journeyId: result.rows[0].id,
      user: {
        id: user.id,
        mobileNumber: user.mobile_number,
        name: user.name,
      },
    });

  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Journey save error:", error);
    res.status(500).json({
      message: "Failed to save journey details",
    });

  } finally {
    client.release();
  }
};


