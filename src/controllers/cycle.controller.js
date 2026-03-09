const db = require("../db");
const { calculateCycle } = require("../utils/cycleCalculator");

exports.getCyclePrediction = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId required",
      });
    }

    // 1️⃣ Get journey details
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

    // 2️⃣ Calculate cycle
    const cycleData = calculateCycle({
      lastPeriodDate: last_period_date,
      cycleLength: cycle_length_days,
    });

    const currentDay = cycleData.currentDay;

    // 3️⃣ Fetch cycle guide data
    const guideResult = await db.query(
      `
   SELECT
  cycle_day,
  phase_of_month,
  phase_in_app,
  estrogen_level,
  progesterone_level,
  mood,
  energy,
  focus,
  social_drive,
  anxiety,
  physical_state,
  mental_state,
  nutrients,
  foods_to_avoid,
  fitness,
  prediction_tips
FROM cycle_guide
WHERE cycle_day = $1;
      `,
      [currentDay]
    );

    const cycleGuide = guideResult.rows[0] || null;

    // 4️⃣ Response
    res.json({
      success: true,
      data: {
        ...cycleData,
        cycleGuide
      }
    });

  } catch (error) {
    console.error("Cycle prediction error:", error);
    res.status(500).json({
      message: "Failed to calculate cycle",
    });
  }
};

exports.getPreviousCycleDetails = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "userId required",
      });
    }

    const result = await db.query(
      `
  SELECT 
    upl.period_date AS last_period_date,
    jd.cycle_length_days
  FROM users u
  LEFT JOIN user_period_log upl
    ON upl.user_id = u.id
  LEFT JOIN journey_details jd
    ON jd.user_id = u.id
  WHERE u.id = $1
  ORDER BY upl.period_date DESC
  LIMIT 1
  `,
      [userId]
    );

    const { last_period_date, cycle_length_days } = result.rows[0];

    // 4️⃣ Response
    res.json({
      success: true,
      lastPeriodDate: last_period_date,
      cycleLength: cycle_length_days,
    });

  } catch (error) {
    console.error("Cycle prediction error:", error);
    res.status(500).json({
      message: "Failed to fetch result",
    });
  }
};


