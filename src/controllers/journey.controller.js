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
    } = req.body;

    if (
      !ageGroup ||
      !dateOfBirth ||
      !cycleLengthDays ||
      !Array.isArray(symptoms) ||
      !lastPeriodDate
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
        last_period_date
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
      `,
      [
        userId,
        ageGroup,
        dateOfBirth,
        cycleLengthDays,
        symptoms,
        lastPeriodDate,
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
