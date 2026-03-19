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

    // 1️⃣ Get base data
    const result = await db.query(
      `
      SELECT 
        u.name,
        j.cycle_length_days,
        j.bleeding_days,
        (
          SELECT period_date
          FROM user_period_log
          WHERE user_id = $1
          ORDER BY period_date DESC
          LIMIT 1
        ) AS last_period_date
      FROM journey_details j
      JOIN users u ON u.id = j.user_id
      WHERE j.user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Journey details not found",
      });
    }

    const { name, last_period_date, cycle_length_days,bleeding_days } = result.rows[0];

    // 2️⃣ Calculate cycle
    const cycleData = calculateCycle({
      lastPeriodDate: last_period_date,
      cycleLength: cycle_length_days,
      bleedingDays:bleeding_days
    });

    const { phase, stage, currentDay } = cycleData;

    // 3️⃣ OLD TABLE (minimal fields)
    const oldGuide = await db.query(
      `
      SELECT
        cycle_day,
        phase_of_month,
        phase_in_app,
        estrogen_level,
        progesterone_level
      FROM cycle_guide
      WHERE cycle_day = $1
      `,
      [currentDay]
    );

    // 4️⃣ NEW TABLE (range + stage match)
    const newGuide = await db.query(
      `
      SELECT *
      FROM cycle_phase_guidelines
      WHERE phase_name=$1
      AND stage = $2
      LIMIT 1
      `,
      [phase, stage]
    );

    const cycleGuide = {
      ...(oldGuide.rows[0] || {}),
      ...(newGuide.rows[0] || {}),
    };

    // 5️⃣ Response
    res.json({
      success: true,
      data: {
        username: name,
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
    jd.cycle_length_days,
    jd.bleeding_days
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

    const { last_period_date, cycle_length_days, bleeding_days } = result.rows[0];

    // 4️⃣ Response
    res.json({
      success: true,
      lastPeriodDate: last_period_date,
      cycleLength: cycle_length_days,
      bleedingDays: bleeding_days
    });

  } catch (error) {
    console.error("Cycle prediction error:", error);
    res.status(500).json({
      message: "Failed to fetch result",
    });
  }
};

exports.getCycleHormoneData = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID missing in headers" });
    }

    // Get cycle length from DB
    const result = await db.query(
      `
      SELECT cycle_length_days
      FROM journey_details
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Journey details not found" });
    }

    const cycleLength = result.rows[0].cycle_length_days;

    // Ovulation logic
    const ovulationDay = cycleLength - 14;
    const fertileStart = ovulationDay - 5;
    const fertileEnd = ovulationDay + 1;

    const cycleData = [];

    for (let day = 1; day <= cycleLength; day++) {

      let estrogen = 0;
      let progesterone = 0;
      let phase = "";

      if (day <= 5) {
        phase = "menstrual";
        estrogen = 0.3;
        progesterone = 0.2;
      }
      else if (day > 5 && day < ovulationDay) {
        phase = "follicular";
        estrogen = 0.4 + (day / cycleLength);
        progesterone = 0.25;
      }
      else if (day === ovulationDay) {
        phase = "ovulation";
        estrogen = 1;
        progesterone = 0.35;
      }
      else {
        phase = "luteal";
        estrogen = 0.6 - (day / (cycleLength * 2));
        progesterone = 0.4 + (day / cycleLength);
      }

      cycleData.push({
        day,
        phase,
        estrogen: Number(estrogen.toFixed(2)),
        progesterone: Number(progesterone.toFixed(2)),
        ovulation: day === ovulationDay,
        fertile_window: day >= fertileStart && day <= fertileEnd
      });
    }

    return res.json({
      cycle_length: cycleLength,
      ovulation_day: ovulationDay,
      fertile_window: {
        start: fertileStart,
        end: fertileEnd
      },
      cycle_data: cycleData
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createDailyLog = async (req, res) => {
  try {
    const userId = req.user.userId;
    const logData = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "User ID missing"
      });
    }

    const result = await db.query(
      `
      INSERT INTO daily_health_logs (user_id, log_date, log_data)
      VALUES ($1, CURRENT_DATE, $2)

      ON CONFLICT (user_id, log_date)
      DO UPDATE SET
        log_data = EXCLUDED.log_data,
        updated_at = NOW()

      RETURNING *;
      `,
      [userId, logData]
    );

    res.json({
      success: true,
      message:
        result.command === "INSERT"
          ? "Daily log created"
          : "Daily log updated",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Daily log error:", error);
    res.status(500).json({
      message: "Failed to save log"
    });
  }
};

exports.getTodayLog = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        message: "User ID missing"
      });
    }

    const result = await db.query(
      `SELECT id, user_id, log_data, log_date, created_at
       FROM daily_health_logs
       WHERE user_id = $1
       AND log_date = CURRENT_DATE`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        hasLog: false,
        data: null
      });
    }

    res.json({
      success: true,
      hasLog: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Get today log error:", error);
    res.status(500).json({
      message: "Failed to fetch log"
    });
  }
};

exports.logLatestPeriod = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { periodDate } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: "userid header required"
      });
    }

    if (!periodDate) {
      return res.status(400).json({
        message: "periodDate required"
      });
    }

    const result = await db.query(
      `
      INSERT INTO user_period_log (
        user_id,
        period_date
      )
      VALUES ($1,$2)
      RETURNING id, period_date
      `,
      [userId, periodDate]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Period log error:", error);

    res.status(500).json({
      message: "Failed to log period date"
    });
  }
};
