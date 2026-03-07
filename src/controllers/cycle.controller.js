const db = require("../config/db");
const { calculateCycle } = require("../utils/cycleCalculator");

exports.getCyclePrediction = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userId required",
      });
    }

    const result = await db.query(
      `
      SELECT last_period_date, cycle_length_days
      FROM journey_details
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Journey details not found",
      });
    }

    const { last_period_date, cycle_length_days } = result.rows[0];

    const cycleData = calculateCycle({
      lastPeriodDate: last_period_date,
      cycleLength: cycle_length_days,
    });

    res.json({
      success: true,
      data: cycleData,
    });
  } catch (error) {
    console.error("Cycle prediction error:", error);
    res.status(500).json({
      message: "Failed to calculate cycle",
    });
  }
};