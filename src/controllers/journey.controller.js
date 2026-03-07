const db = require("../db");

exports.saveJourneyDetails = async (req, res) => {
  try {
    const userId = req.user.userId;

    const {
      ageGroup,
      dateOfBirth,
      cycleLengthDays,
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
        symptoms,
        last_period_date,
        health_goals,
        diagnosed_conditions,
        tracking_symptoms
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id
      `,
      [
        userId,
        ageGroup,
        dateOfBirth,
        cycleLengthDays,
        symptoms,
        lastPeriodDate,
        healthGoals,
        diagnosedConditions || [],
        trackingSymptoms || [],
      ]
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
