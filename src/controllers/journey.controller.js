const db = require("../db");

exports.saveJourneyDetails = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId required",
      });
    }

   const {
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
      !ageGroup ||
      !dateOfBirth ||
      !cycleLengthDays ||
      !bleedingDays ||
      !Array.isArray(symptoms) ||
      !lastPeriodDate ||
      !Array.isArray(healthGoals)
    ) {
      return res.status(400).json({
        message: "Missing journey details",
      });
    }

    const result = await db.query(
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
        symptoms,
        lastPeriodDate,
        healthGoals,
        diagnosedConditions || [],
        trackingSymptoms || [],
      ]
    );

    // 2️⃣ Insert into period log table
    await client.query(
      `
      INSERT INTO user_period_log (
        user_id,
        period_date
      )
      VALUES ($1,$2)
      `,
      [userId, lastPeriodDate]
    );

    res.status(201).json({
      success: true,
      journeyId: result.rows[0].id,
    });
  } catch (error) {
    console.error("Journey save error:", error);
    res.status(500).json({
      message: "Failed to save journey details",
    });
  }
};


