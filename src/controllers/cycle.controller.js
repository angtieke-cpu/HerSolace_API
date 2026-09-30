const db = require("../db");
const {
    calculateCycle,
    resolveEffectiveCycleStart,
    averageCycleLength,
    APP_TIMEZONE,
} = require("../utils/cycleCalculator");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);


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

                lp.period_date AS last_period_date,
                lp.bleeding_days,
                lp.cycle_length AS cycle_length_days

            FROM users u

            LEFT JOIN LATERAL (
                SELECT 
                    period_date,
                    bleeding_days,
                    cycle_length
                FROM user_period_log
                WHERE user_id = u.id
                ORDER BY period_date DESC
                LIMIT 1
            ) lp ON TRUE

            WHERE u.id = $1;
            `,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Journey details not found",
            });
        }

        const {
            name,
            last_period_date,
            cycle_length_days,
            bleeding_days,
        } = result.rows[0];

        if (!last_period_date) {
            return res.status(400).json({
                message: "No period data available",
            });
        }

        // 2️⃣ Calculate cycle — today's day/phase, and the "missed cycle" delay adjustment,
        // both come from the one shared calculateCycle() util now (same algorithm the Calendar
        // and AI endpoints use), instead of this endpoint working it out separately and
        // sometimes landing on a different day/phase than the other screens.

        const cycleData = calculateCycle({
            lastPeriodDate: last_period_date,
            cycleLength: Number(cycle_length_days) || 28,
            bleedingDays: bleeding_days,
        });

        const {
            phase,
            stage,
            currentDay,
        } = cycleData;

        // 4️⃣ OLD TABLE
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

        // 5️⃣ NEW TABLE
        const newGuide = await db.query(
            `
            SELECT *
            FROM cycle_phase_guidelines
            WHERE phase_name = $1
              AND stage = $2
            LIMIT 1
            `,
            [phase, stage]
        );

        // 6️⃣ Combine cycle guide data

      // 6️⃣ Combine cycle guide data

// 6️⃣ Combine cycle guide data

// 6️⃣ Combine cycle guide data

const oldGuideData = oldGuide.rows[0] || {};
const newGuideData = newGuide.rows[0] || {};

const {
    daily_highlight,
    nutrients,
    fitness,
    insights
} = newGuideData;

const combinedDailyHighlight = [
    daily_highlight,
    nutrients,
    fitness,
    insights
]
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(value => String(value).trim());

const cycleGuide = {
    ...oldGuideData,
    ...newGuideData,

    daily_highlight: combinedDailyHighlight
};

        // 7️⃣ Response

        return res.json({
            success: true,
            data: {
                username: name,

                // Includes delayDays/adjustedCycleLength already — calculateCycle() computes
                // both as part of the same missed-cycle rollover it uses for currentDay/phase.
                ...cycleData,

                cycleGuide,
            },
        });

    } catch (error) {
        console.error(
            "Cycle prediction error:",
            error
        );

        return res.status(500).json({
            message: "Failed to calculate cycle",
        });
    }
};

exports.checkLatestPeriodLogged = async (req, res) => {
    try {
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userid header required"
            });
        }

        // Latest period log
        const result = await db.query(
            `
            SELECT
                period_date,
                cycle_length
            FROM user_period_log
            WHERE user_id = $1
            ORDER BY period_date DESC
            LIMIT 1
            `,
            [userId]
        );

        // No logs found
        if (result.rows.length === 0) {
            return res.json({
                success: true,
                hasLoggedLatestPeriod: false,
                message: "No period logs found."
            });
        }

        const log = result.rows[0];

        const cycleLength = Number(log.cycle_length) || 28;

        const today = dayjs()
            .tz("Asia/Kolkata")
            .startOf("day");

        const lastPeriod = dayjs(log.period_date)
            .tz("Asia/Kolkata")
            .startOf("day");

        const nextExpectedPeriod = lastPeriod.add(cycleLength, "day");

        const hasLoggedLatestPeriod = today.isBefore(nextExpectedPeriod);

        return res.json({
            success: true,
            hasLoggedLatestPeriod,
            lastPeriodDate: lastPeriod.format("YYYY-MM-DD"),
            expectedNextPeriod: nextExpectedPeriod.format("YYYY-MM-DD"),
            daysOverdue: hasLoggedLatestPeriod
                ? 0
                : today.diff(nextExpectedPeriod, "day")
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Internal server error"
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
        period_date AS last_period_date,
        cycle_length AS cycle_length_days,
        bleeding_days
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date DESC
      LIMIT 1
      `,
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "No cycle data found",
            });
        }

        const {
            last_period_date,
            cycle_length_days,
            bleeding_days,
        } = result.rows[0];

        if (!last_period_date) {
            return res.status(400).json({
                message: "Invalid period data",
            });
        }

        // 🔧 Apply delay logic
        const today = new Date(
            new Date().toLocaleString("en-US", {
                timeZone: "Asia/Kolkata",
            })
        );
        const lastPeriodDate = new Date(last_period_date);

        const diffTime = today - lastPeriodDate;
        const diffDays =
            Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;


        let adjustedCycleLength = cycle_length_days || 28;
        let delayDays = 0;

        // 👉 Extend cycle if delayed
        if (diffDays > adjustedCycleLength) {
            delayDays = diffDays - adjustedCycleLength;
            adjustedCycleLength = adjustedCycleLength + delayDays;
        }



        // ✅ Response
        res.json({
            success: true,
            lastPeriodDate: last_period_date,
            cycleLength: adjustedCycleLength,
            bleedingDays: bleeding_days,
            delayDays,
        });

    } catch (error) {
        console.error("Cycle fetch error:", error);
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
    const userId = req.user?.userId;

    const {
      logDate,
      logData,
      dailyCheckIn = {}
    } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing"
      });
    }

    if (!logDate) {
      return res.status(400).json({
        success: false,
        message: "logDate is required"
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      return res.status(400).json({
        success: false,
        message: "logDate must be in YYYY-MM-DD format"
      });
    }

    // Validate logData
    if (!Array.isArray(logData)) {
      return res.status(400).json({
        success: false,
        message: "logData must be an array"
      });
    }

    // Validate symptoms
    const invalidSymptom = logData.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !item.symptomId ||
        typeof item.symptomId !== "string"
    );

    if (invalidSymptom) {
      return res.status(400).json({
        success: false,
        message: "Each logData item must contain a valid symptomId"
      });
    }

    // Validate dailyCheckIn
    if (
      dailyCheckIn === null ||
      typeof dailyCheckIn !== "object" ||
      Array.isArray(dailyCheckIn)
    ) {
      return res.status(400).json({
        success: false,
        message: "dailyCheckIn must be an object"
      });
    }

    const result = await db.query(
      `
      INSERT INTO daily_health_logs (
        user_id,
        log_date,
        log_data,
        daily_check_in
      )
      VALUES (
        $1,
        $2::date,
        $3::jsonb,
        $4::jsonb
      )

      ON CONFLICT (user_id, log_date)
      DO UPDATE SET
        log_data = EXCLUDED.log_data,
        daily_check_in = EXCLUDED.daily_check_in,
        updated_at = NOW()

      RETURNING
        id,
        user_id AS "userId",
        log_date AS "logDate",
        log_data AS "logData",
        daily_check_in AS "dailyCheckIn",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [
        userId,
        logDate,
        JSON.stringify(logData),
        JSON.stringify(dailyCheckIn)
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Daily log saved successfully",
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Daily log error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save daily log"
    });
  }
};

exports.getTodayLog = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { logDate } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing"
      });
    }

    if (!logDate) {
      return res.status(400).json({
        success: false,
        message: "logDate is required"
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) {
      return res.status(400).json({
        success: false,
        message: "logDate must be in YYYY-MM-DD format"
      });
    }

    const result = await db.query(
      `
      SELECT
        id,
        user_id AS "userId",
        log_date AS "logDate",
        log_data AS "logData",
        daily_check_in AS "dailyCheckIn",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM daily_health_logs
      WHERE user_id = $1
        AND log_date = $2::date
      LIMIT 1
      `,
      [userId, logDate]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        hasLog: false,
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      hasLog: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error("Get log error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch log"
    });
  }
};
exports.logLatestPeriod = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { periodDate } = req.body;

        if (!userId) {
            return res.status(400).json({ message: "userid header required" });
        }

        if (!periodDate) {
            return res.status(400).json({ message: "periodDate required" });
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate) || !dayjs(periodDate).isValid()) {
            return res.status(400).json({ message: "periodDate must be in YYYY-MM-DD format" });
        }

        const todayKey = dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD");
        if (periodDate > todayKey) {
            return res.status(400).json({ message: "periodDate cannot be in the future" });
        }

        // ✅ 1. Get past records
        const prevResult = await db.query(
            `
      SELECT id, period_date, bleeding_days, cycle_length
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date DESC
      `,
            [userId]
        );

        const rows = prevResult.rows;
        const existingDates = rows.map((r) => dayjs(r.period_date).format("YYYY-MM-DD"));

        // Logging the same start date twice would create a zero-day "cycle" and a duplicate row.
        if (existingDates.includes(periodDate)) {
            return res.status(409).json({ message: "This period date is already logged" });
        }

        // ✅ 2. Cycle length — same averaging the Calendar endpoint uses, so Home/AI (which read
        // this stored value) and Calendar (which derives it from history) always agree.
        const cycle_length = averageCycleLength(
            [...existingDates, periodDate],
            rows[0]?.cycle_length || 28
        );

        // ✅ 3. Bleeding days — average of the recent logged values, defaulting like Calendar does
        const bleedValues = rows
            .slice(0, 6)
            .map(r => Number(r.bleeding_days))
            .filter(v => v > 0);

        const bleeding_days = bleedValues.length > 0
            ? Math.round(bleedValues.reduce((a, b) => a + b, 0) / bleedValues.length)
            : 5;

        // A backfilled older date changes the average too — keep the latest row (the one Home/AI
        // read) in sync with it.
        if (rows.length > 0 && periodDate < existingDates[0]) {
            await db.query(
                `UPDATE user_period_log SET cycle_length = $1 WHERE id = $2`,
                [cycle_length, rows[0].id]
            );
        }

        // ✅ 4. Insert new record
        const result = await db.query(
            `
      INSERT INTO user_period_log (
        user_id,
        period_date,
        cycle_length,
        bleeding_days
      )
      VALUES ($1,$2,$3,$4)
      RETURNING id, period_date, cycle_length, bleeding_days
      `,
            [userId, periodDate, cycle_length, bleeding_days]
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

exports.getUserPeriodLogs = async (req, res) => {
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
        id,
        period_date,
        cycle_length,
        bleeding_days,
        created_at
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date DESC
      `,
            [userId]
        );

        const logs = result.rows;

        // ✅ Apply delay logic only for latest log
        if (logs.length > 0) {
            const latestLog = logs[0];

            const today = new Date(
                new Date().toLocaleString("en-US", {
                    timeZone: "Asia/Kolkata",
                })
            );

            today.setHours(0, 0, 0, 0);

            const lastPeriodDate = new Date(
                new Date(latestLog.period_date).toLocaleString(
                    "en-US",
                    {
                        timeZone: "Asia/Kolkata",
                    }
                )
            );

            lastPeriodDate.setHours(0, 0, 0, 0);

            const diffTime =
                today.getTime() -
                lastPeriodDate.getTime();

            const diffDays =
                Math.floor(
                    diffTime / (1000 * 60 * 60 * 24)
                ) + 1;

            let adjustedCycleLength =
                Number(latestLog.cycle_length) || 28;

            // ✅ Extend cycle if delayed
            if (diffDays > adjustedCycleLength) {
                adjustedCycleLength =
                    adjustedCycleLength +
                    (diffDays - adjustedCycleLength);

                // ✅ Replace existing field
                logs[0].cycle_length =
                    adjustedCycleLength;
            }
        }

        return res.json({
            success: true,
            count: logs.length,
            data: logs
        });

    } catch (error) {
        console.error("Get logs error:", error);

        return res.status(500).json({
            message: "Failed to fetch period logs"
        });
    }
};



exports.updateLatestCycleDetails = async (req, res) => {

    try {

        const userId = req.user.userId;


        const {
            periodDate,
            bleedingDays,
            cycleLength
        } = req.body;



        if (!userId) {
            return res.status(400).json({
                message: "userId required"
            });
        }



        if (
            !periodDate &&
            !bleedingDays &&
            !cycleLength
        ) {

            return res.status(400).json({
                message: "At least one field required"
            });

        }



        // Get latest cycle record

        const latestResult = await db.query(
            `
      SELECT id, cycle_length
      FROM user_period_log
      WHERE user_id=$1
      ORDER BY period_date DESC
      LIMIT 1
      `,
            [userId]
        );



        if (latestResult.rows.length === 0) {

            return res.status(404).json({
                message: "No cycle found"
            });

        }



        const latestId =
            latestResult.rows[0].id;




        // Dynamic update

        const updates = [];
        const values = [];


        let index = 1;



        if (periodDate) {

            if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate) || !dayjs(periodDate).isValid()) {
                return res.status(400).json({
                    message: "periodDate must be in YYYY-MM-DD format"
                });
            }

            if (periodDate > dayjs().tz(APP_TIMEZONE).format("YYYY-MM-DD")) {
                return res.status(400).json({
                    message: "periodDate cannot be in the future"
                });
            }

            const otherResult = await db.query(
                `
          SELECT period_date
          FROM user_period_log
          WHERE user_id=$1 AND id<>$2
          `,
                [userId, latestId]
            );

            const otherDates = otherResult.rows.map(
                (r) => dayjs(r.period_date).format("YYYY-MM-DD")
            );

            // Must stay the latest entry and not collide with another logged period.
            if (otherDates.some((date) => date >= periodDate)) {
                return res.status(400).json({
                    message: "periodDate must be after your previously logged periods"
                });
            }

            updates.push(
                `period_date=$${index++}`
            );

            values.push(periodDate);

            // Moving the start date changes the gap to the previous period — recompute the
            // stored average (what Home/AI read) the same way Calendar derives it from history,
            // unless the caller is setting cycleLength explicitly.
            if (!cycleLength && otherDates.length > 0) {
                updates.push(
                    `cycle_length=$${index++}`
                );

                values.push(
                    averageCycleLength(
                        [...otherDates, periodDate],
                        latestResult.rows[0].cycle_length || 28
                    )
                );
            }

        }



        if (bleedingDays) {

            if (
                bleedingDays < 1 ||
                bleedingDays > 15
            ) {

                return res.status(400).json({
                    message: "Invalid bleeding days"
                });

            }


            updates.push(
                `bleeding_days=$${index++}`
            );

            values.push(
                bleedingDays
            );

        }




        if (cycleLength) {

            if (
                cycleLength < 15 ||
                cycleLength > 60
            ) {

                return res.status(400).json({
                    message: "Invalid cycle length"
                });

            }



            updates.push(
                `cycle_length=$${index++}`
            );


            values.push(
                cycleLength
            );

        }




        values.push(latestId);



        const updateResult = await db.query(
            `
      UPDATE user_period_log

      SET ${updates.join(", ")}

      WHERE id=$${index}

      RETURNING
        id,
        period_date,
        bleeding_days,
        cycle_length
      `,
            values
        );




        const updated =
            updateResult.rows[0];



        return res.json({

            success: true,

            message: "Cycle details updated successfully",

            data: {

                id: updated.id,

                period_date:
                    updated.period_date,

                bleeding_days:
                    updated.bleeding_days,

                cycle_length:
                    updated.cycle_length

            }

        });



    }
    catch (error) {

        console.error(
            "updateLatestCycleDetails:",
            error
        );


        return res.status(500).json({

            message:
                "Failed to update cycle details"

        });

    }

};
exports.getCycleCalendarDetails = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid required"
      });
    }

    /*
     * Optional:
     * GET /api/cycle/calendar-details?month=2026-07
     *
     * When month is supplied, selectedMonthData will contain
     * only that month's calendar details.
     */
    const { month } = req.query;

    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: "month must be in YYYY-MM format"
      });
    }

    const today = dayjs()
      .tz("Asia/Kolkata")
      .startOf("day");

    /*
     * Prediction range:
     * Previous 6 calendar months through future 12 calendar months.
     */
    const rangeStart = today
      .subtract(6, "month")
      .startOf("month");

    const rangeEnd = today
      .add(12, "month")
      .endOf("month");

    // ---------------------------------------------------------
    // 1. Fetch complete period history
    // ---------------------------------------------------------

    const periodResult = await db.query(
      `
      SELECT
        id,
        period_date,
        bleeding_days,
        cycle_length
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date ASC
      `,
      [userId]
    );

    /*
     * Return calendar support data even when period history
     * does not exist.
     */
    if (periodResult.rows.length === 0) {
      const [healthLogsResult, plannerResult] = await Promise.all([
        db.query(
          `
          SELECT
            id,
            log_date,
            log_data,
            created_at,
            updated_at
          FROM daily_health_logs
          WHERE user_id = $1
            AND log_date BETWEEN $2::date AND $3::date
          ORDER BY log_date ASC
          `,
          [
            userId,
            rangeStart.format("YYYY-MM-DD"),
            rangeEnd.format("YYYY-MM-DD")
          ]
        ),

        db.query(
          `
          SELECT
            id,
            start_date,
            end_date,
            purpose,
            activity,
            ai_insights,
            created_at,
            updated_at
          FROM cycle_trip_planner_insights
          WHERE user_id = $1
            AND start_date <= $3::date
            AND end_date >= $2::date
          ORDER BY start_date ASC
          `,
          [
            userId,
            rangeStart.format("YYYY-MM-DD"),
            rangeEnd.format("YYYY-MM-DD")
          ]
        )
      ]);

      const healthLogDates = healthLogsResult.rows.map((row) => ({
        id: row.id,
        date: dayjs(row.log_date).format("YYYY-MM-DD"),
        logData: row.log_data,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

      const plannerDates = [];

      for (const planner of plannerResult.rows) {
        let currentDate = dayjs(planner.start_date).startOf("day");
        const plannerEnd = dayjs(planner.end_date).startOf("day");

        while (
          currentDate.isBefore(plannerEnd, "day") ||
          currentDate.isSame(plannerEnd, "day")
        ) {
          if (
            !currentDate.isBefore(rangeStart, "day") &&
            !currentDate.isAfter(rangeEnd, "day")
          ) {
            plannerDates.push({
              plannerId: planner.id,
              date: currentDate.format("YYYY-MM-DD"),
              startDate: dayjs(planner.start_date).format("YYYY-MM-DD"),
              endDate: dayjs(planner.end_date).format("YYYY-MM-DD"),
              purpose: planner.purpose,
              activity: planner.activity,
              isStartDate: currentDate.isSame(
                dayjs(planner.start_date),
                "day"
              ),
              isEndDate: currentDate.isSame(
                dayjs(planner.end_date),
                "day"
              )
            });
          }

          currentDate = currentDate.add(1, "day");
        }
      }

      return res.json({
        success: true,
        message: "No cycle history found",
        data: {
          range: {
            startDate: rangeStart.format("YYYY-MM-DD"),
            endDate: rangeEnd.format("YYYY-MM-DD"),
            previousMonths: 6,
            futureMonths: 12
          },

          cycleSummary: null,
          confirmedPeriods: [],
          predictedCycles: [],
          healthLogDates,
          plannerDates
        }
      });
    }

    // ---------------------------------------------------------
    // 2. Format history
    // ---------------------------------------------------------

    const history = periodResult.rows.map((row, index, rows) => {
      const periodDate = dayjs(row.period_date).startOf("day");
      const nextRow = rows[index + 1];

      return {
        id: row.id,

        periodDate: periodDate.format("YYYY-MM-DD"),

        bleedingDays:
          Number(row.bleeding_days) || 5,

        // Stored value - the running average at the time this period was logged.
        cycleLength:
          row.cycle_length !== null
            ? Number(row.cycle_length)
            : null,

        /*
         * Real length of this cycle: days from this period to the next logged one.
         * null for the latest period, whose cycle is still in progress.
         */
        actualCycleLength: nextRow
          ? dayjs(nextRow.period_date).startOf("day").diff(periodDate, "day")
          : null
      };
    });

    // ---------------------------------------------------------
    // 3. Average cycle length
    // Same helper logLatestPeriod uses to store cycle_length on
    // the latest row (what Home / AI read), so all screens agree.
    // ---------------------------------------------------------

    let cycleLength = averageCycleLength(
      history.map((record) => record.periodDate),
      history[history.length - 1].cycleLength || 28
    );

    /*
     * Prevent invalid database values from breaking prediction.
     */
    if (
      !Number.isFinite(cycleLength) ||
      cycleLength < 15 ||
      cycleLength > 60
    ) {
      cycleLength = 28;
    }

    const lastRecord = history[history.length - 1];

    const lastPeriod = dayjs(
      lastRecord.periodDate
    ).startOf("day");

    const bleedingDays =
      Number(lastRecord.bleedingDays) || 5;

    // ---------------------------------------------------------
    // 4. Effective current-cycle start — shared with getCyclePrediction (Home) and the AI
    // endpoints via cycleCalculator's resolveEffectiveCycleStart, so all three can't disagree
    // on which cycle "today" actually falls in.
    // ---------------------------------------------------------

    const { effectiveStart: effectiveCycleStart, missedFullCycles } =
      resolveEffectiveCycleStart(lastPeriod, cycleLength, today);

    /*
     * True once at least one whole cycle has unambiguously been missed (not just today running
     * a little late) - i.e. a cycle silently started and ended without a new DB entry.
     */
    const missedCycleDetected = missedFullCycles > 0;

    // ---------------------------------------------------------
    // 5. Current cycle prediction
    // Ovulation is cycle day (cycleLength - 14), 1-indexed - the
    // same day calculateCycle() (Home dial / AI / notifications)
    // and getCycleHormoneData use - i.e. start + cycleLength - 15.
    // ---------------------------------------------------------

    const ovulation = effectiveCycleStart.add(
      cycleLength - 15,
      "day"
    );

    const fertileStart =
      ovulation.subtract(2, "day");

    const fertileEnd =
      ovulation.add(2, "day");

    const rawNextPeriod =
      effectiveCycleStart.add(
        cycleLength,
        "day"
      );

    /*
     * Overdue when a cycle was already missed (an expected
     * period date passed without a new DB entry) or when the
     * predicted next period falls today or earlier. In both
     * cases we don't know the real start date, so show it as
     * tomorrow instead of jumping a full cycle ahead.
     */
    const isOverdue =
      missedCycleDetected ||
      !rawNextPeriod.isAfter(today, "day");

    const nextPeriod = isOverdue
      ? today.add(1, "day")
      : rawNextPeriod;

    const pmsStart =
      nextPeriod.subtract(5, "day");

    const pmsEnd =
      nextPeriod.subtract(1, "day");

    const daysUntilNextPeriod =
      nextPeriod.diff(today, "day");

    let fertilityLevel = "Low";

    if (today.isSame(ovulation, "day")) {
      fertilityLevel = "Peak";
    } else if (
      (
        today.isAfter(fertileStart, "day") ||
        today.isSame(fertileStart, "day")
      ) &&
      (
        today.isBefore(fertileEnd, "day") ||
        today.isSame(fertileEnd, "day")
      )
    ) {
      fertilityLevel = "High";
    }

    // ---------------------------------------------------------
    // 6. Regularity
    // A cycle is regular when it lasts 21-40 days. Every completed
    // cycle must fall in that range for the history to count as
    // Regular; the score is the share of completed cycles that do.
    // ---------------------------------------------------------

    const REGULAR_MIN_DAYS = 21;
    const REGULAR_MAX_DAYS = 40;

    let regularity = "—";
    let regularityScore = 0;

    const completedCycleLengths = history
      .map((record) => record.actualCycleLength)
      .filter((length) => length !== null);

    if (completedCycleLengths.length > 0) {
      const regularCount = completedCycleLengths.filter(
        (length) =>
          length >= REGULAR_MIN_DAYS &&
          length <= REGULAR_MAX_DAYS
      ).length;

      regularity =
        regularCount === completedCycleLengths.length
          ? "Regular"
          : "Irregular";

      regularityScore = Math.round(
        (regularCount / completedCycleLengths.length) * 100
      );
    }

    // ---------------------------------------------------------
    // 7. Confirmed period days
    // ---------------------------------------------------------

    const confirmedPeriods = [];

    for (const [historyIndex, record] of history.entries()) {
      const periodStart = dayjs(
        record.periodDate
      ).startOf("day");

      const recordBleedingDays =
        Number(record.bleedingDays) || 5;

      /*
       * When the next period was logged, this cycle's real length
       * is known - ovulation was ~14 days before that period,
       * not before the originally predicted one.
       */
      const nextLoggedRecord = history[historyIndex + 1];

      const recordCycleLength = nextLoggedRecord
        ? dayjs(nextLoggedRecord.periodDate).diff(periodStart, "day")
        : Number(record.cycleLength) || cycleLength;

      const recordOvulation =
        periodStart.add(
          recordCycleLength - 15,
          "day"
        );

      for (
        let dayIndex = 0;
        dayIndex < recordBleedingDays;
        dayIndex++
      ) {
        const periodDay =
          periodStart.add(dayIndex, "day");

        if (
          !periodDay.isBefore(rangeStart, "day") &&
          !periodDay.isAfter(rangeEnd, "day")
        ) {
          confirmedPeriods.push({
            periodLogId: record.id,
            date: periodDay.format("YYYY-MM-DD"),
            periodStartDate:
              periodStart.format("YYYY-MM-DD"),
            dayNumber: dayIndex + 1,
            type: "period",
            status: "confirmed"
          });
        }
      }

      if (
        !recordOvulation.isBefore(rangeStart, "day") &&
        !recordOvulation.isAfter(rangeEnd, "day")
      ) {
        confirmedPeriods.push({
          periodLogId: record.id,
          date: recordOvulation.format("YYYY-MM-DD"),
          periodStartDate:
            periodStart.format("YYYY-MM-DD"),
          type: "ovulation",
          status: "historical_calculation"
        });
      }
    }

    // ---------------------------------------------------------
    // 8. Build cycle entries.
    // Past cycles use the actual logged history within the
    // previous-6-months range (their own cycle length /
    // bleeding days) instead of fabricated predictions - only
    // as many past entries exist as are actually logged.
    // Current + future cycles are generated using the averaged
    // cycle length / bleeding days since they are not logged yet.
    // ---------------------------------------------------------

    const predictedCycles = [];
    let predictionIndex = 0;

    const collectPeriodDates = (start, count) => {
      const dates = [];

      for (
        let dayIndex = 0;
        dayIndex < count;
        dayIndex++
      ) {
        const date = start.add(dayIndex, "day");

        if (
          !date.isBefore(rangeStart, "day") &&
          !date.isAfter(rangeEnd, "day")
        ) {
          dates.push(date.format("YYYY-MM-DD"));
        }
      }

      return dates;
    };

    const collectDatesInRange = (start, end) => {
      const dates = [];
      let cursor = start;

      while (
        cursor.isBefore(end, "day") ||
        cursor.isSame(end, "day")
      ) {
        if (
          !cursor.isBefore(rangeStart, "day") &&
          !cursor.isAfter(rangeEnd, "day")
        ) {
          dates.push(cursor.format("YYYY-MM-DD"));
        }

        cursor = cursor.add(1, "day");
      }

      return dates;
    };

    const buildCycleEntry = (
      cycleStart,
      cycleStartLength,
      cycleStartBleedingDays,
      position,
      overrideNextPeriod
    ) => {
      /*
       * Ovulation / fertile / PMS are all derived from the next
       * period date (luteal phase is ~14 fixed days before the
       * next period), so when overrideNextPeriod is supplied
       * (an overdue current cycle whose real next-period date is
       * now known to be later than the averaged cycle length),
       * they shift together with it instead of staying pinned to
       * the stale cycleStart + averaged-length estimate.
       */
      const cycleNextPeriod =
        overrideNextPeriod ||
        cycleStart.add(cycleStartLength, "day");

      // Cycle day (length - 14), matching calculateCycle().
      const cycleOvulation =
        cycleNextPeriod.subtract(15, "day");

      const cycleFertileStart =
        cycleOvulation.subtract(2, "day");

      const cycleFertileEnd =
        cycleOvulation.add(2, "day");

      const cyclePmsStart =
        cycleNextPeriod.subtract(5, "day");

      const cyclePmsEnd =
        cycleNextPeriod.subtract(1, "day");

      return {
        predictionIndex: predictionIndex++,

        cycleStartDate:
          cycleStart.format("YYYY-MM-DD"),

        cycleLength: cycleStartLength,
        bleedingDays: cycleStartBleedingDays,

        periodDates: collectPeriodDates(
          cycleStart,
          cycleStartBleedingDays
        ),

        fertileWindow: {
          startDate:
            cycleFertileStart.format("YYYY-MM-DD"),

          endDate:
            cycleFertileEnd.format("YYYY-MM-DD"),

          dates: collectDatesInRange(
            cycleFertileStart,
            cycleFertileEnd
          )
        },

        ovulationDate:
          cycleOvulation.format("YYYY-MM-DD"),

        pmsWindow: {
          startDate:
            cyclePmsStart.format("YYYY-MM-DD"),

          endDate:
            cyclePmsEnd.format("YYYY-MM-DD"),

          dates: collectDatesInRange(
            cyclePmsStart,
            cyclePmsEnd
          )
        },

        nextPeriodDate:
          cycleNextPeriod.format("YYYY-MM-DD"),

        position
      };
    };

    /*
     * Past cycles: only the periods actually logged in the DB
     * within the previous-6-months window. Nothing is fabricated
     * to fill the range beyond what was actually logged.
     */
    for (const [historyIndex, record] of history.entries()) {
      const periodStart = dayjs(
        record.periodDate
      ).startOf("day");

      if (
        !periodStart.isBefore(effectiveCycleStart, "day") ||
        periodStart.isBefore(rangeStart, "day")
      ) {
        continue;
      }

      /*
       * A past cycle that was followed by another logged period
       * actually ended the day that period started - e.g. a
       * period logged 5 days earlier than predicted. Its window
       * must end there too, or it keeps overlapping the new cycle
       * (the Log screen then reads today as "Luteal" from the old
       * cycle, and its PMS days paint over the new period).
       */
      const nextLoggedRecord = history[historyIndex + 1];

      if (nextLoggedRecord) {
        const nextLoggedStart = dayjs(
          nextLoggedRecord.periodDate
        ).startOf("day");

        predictedCycles.push(
          buildCycleEntry(
            periodStart,
            nextLoggedStart.diff(periodStart, "day"),
            Number(record.bleedingDays) || 5,
            "past",
            nextLoggedStart
          )
        );
        continue;
      }

      /*
       * The most recently logged cycle is the one that's
       * currently overdue (that's the only way it can end up in
       * this "past" loop at all) - its next-period date and
       * derived phases should reflect the overdue-aware
       * `nextPeriod`, not the stale cycleLength-based guess that
       * never actually happened.
       */
      const isMostRecentLoggedCycle =
        periodStart.isSame(lastPeriod, "day");

      predictedCycles.push(
        buildCycleEntry(
          periodStart,
          Number(record.cycleLength) || cycleLength,
          Number(record.bleedingDays) || 5,
          "past",
          isMostRecentLoggedCycle ? nextPeriod : undefined
        )
      );
    }

    /*
     * Current cycle: effectiveCycleStart is the actual/assumed
     * start of the cycle in progress. Pushed when not overdue, or
     * when overdue but that start IS the last logged period (a
     * period that's just running late) - that cycle is still in
     * progress and must cover today, otherwise the Log screen has
     * no phase for today while Home shows "Luteal". Its end is
     * the overdue-aware `nextPeriod`.
     * When a whole cycle was missed, effectiveCycleStart's
     * period never got a DB entry confirming it started, so no
     * period-days block is fabricated for it - the logged cycle
     * above already stretches to `nextPeriod`, and the chain below
     * picks up the "current" label instead.
     */
    const pushCurrentCycle = !isOverdue || !missedCycleDetected;

    if (
      pushCurrentCycle &&
      !effectiveCycleStart.isAfter(rangeEnd, "day")
    ) {
      predictedCycles.push(
        buildCycleEntry(
          effectiveCycleStart,
          cycleLength,
          bleedingDays,
          "current",
          nextPeriod
        )
      );
    }

    /*
     * Future cycles: not logged yet, generated using the
     * averaged cycle length / bleeding days, starting from the
     * overdue-aware `nextPeriod`. When overdue, this is the same
     * date as the current-cycle push above would have used, so
     * the first entry here takes the "current" label instead of
     * duplicating it - the whole chain shifts forward instead of
     * continuing from the now-too-late effectiveCycleStart chain.
     */
    let cycleStart = nextPeriod;
    let isFirstInFutureChain = true;

    while (!cycleStart.isAfter(rangeEnd, "day")) {
      predictedCycles.push(
        buildCycleEntry(
          cycleStart,
          cycleLength,
          bleedingDays,
          !pushCurrentCycle && isFirstInFutureChain
            ? "current"
            : "future"
        )
      );

      isFirstInFutureChain = false;
      cycleStart = cycleStart.add(cycleLength, "day");
    }

    // ---------------------------------------------------------
    // 9. Fetch health logs and planner ranges
    // ---------------------------------------------------------

    const [healthLogsResult, plannerResult] =
      await Promise.all([
        db.query(
          `
          SELECT
            id,
            log_date,
            log_data,
            created_at,
            updated_at
          FROM daily_health_logs
          WHERE user_id = $1
            AND log_date BETWEEN $2::date AND $3::date
          ORDER BY log_date ASC
          `,
          [
            userId,
            rangeStart.format("YYYY-MM-DD"),
            rangeEnd.format("YYYY-MM-DD")
          ]
        ),

        db.query(
          `
          SELECT
            id,
            start_date,
            end_date,
            purpose,
            activity,
            ai_insights,
            created_at,
            updated_at
          FROM cycle_trip_planner_insights
          WHERE user_id = $1
            AND start_date <= $3::date
            AND end_date >= $2::date
          ORDER BY start_date ASC, created_at DESC
          `,
          [
            userId,
            rangeStart.format("YYYY-MM-DD"),
            rangeEnd.format("YYYY-MM-DD")
          ]
        )
      ]);

    const healthLogDates =
      healthLogsResult.rows.map((row) => ({
        id: row.id,

        date: dayjs(row.log_date)
          .format("YYYY-MM-DD"),

        logData: row.log_data,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));

    /*
     * Expand each planner range so every planner day
     * can be marked on the calendar.
     */
    const plannerDates = [];

    for (const planner of plannerResult.rows) {
      const plannerStart =
        dayjs(planner.start_date).startOf("day");

      const plannerEnd =
        dayjs(planner.end_date).startOf("day");

      let plannerDate = plannerStart;

      while (
        plannerDate.isBefore(plannerEnd, "day") ||
        plannerDate.isSame(plannerEnd, "day")
      ) {
        if (
          !plannerDate.isBefore(rangeStart, "day") &&
          !plannerDate.isAfter(rangeEnd, "day")
        ) {
          plannerDates.push({
            plannerId: planner.id,

            date:
              plannerDate.format("YYYY-MM-DD"),

            startDate:
              plannerStart.format("YYYY-MM-DD"),

            endDate:
              plannerEnd.format("YYYY-MM-DD"),

            purpose: planner.purpose,
            activity: planner.activity,

            isStartDate:
              plannerDate.isSame(
                plannerStart,
                "day"
              ),

            isEndDate:
              plannerDate.isSame(
                plannerEnd,
                "day"
              ),

            aiInsights: planner.ai_insights
          });
        }

        plannerDate =
          plannerDate.add(1, "day");
      }
    }

    // ---------------------------------------------------------
    // 10. Create one combined calendar-day map
    // ---------------------------------------------------------

    const calendarMap = {};

    const getCalendarDay = (date) => {
      if (!calendarMap[date]) {
        calendarMap[date] = {
          date,
          month: date.slice(0, 7),

          cycleMarks: {
            confirmedPeriod: false,
            predictedPeriod: false,
            fertile: false,
            ovulation: false,
            pms: false
          },

          cycleDetails: [],
          healthLogs: [],
          planners: []
        };
      }

      return calendarMap[date];
    };

    /*
     * Confirmed period data has priority over prediction.
     */
    for (const item of confirmedPeriods) {
      const calendarDay =
        getCalendarDay(item.date);

      if (item.type === "period") {
        calendarDay.cycleMarks.confirmedPeriod =
          true;
      }

      if (item.type === "ovulation") {
        calendarDay.cycleMarks.ovulation =
          true;
      }

      calendarDay.cycleDetails.push(item);
    }

    for (const cycle of predictedCycles) {
      for (const date of cycle.periodDates) {
        const calendarDay =
          getCalendarDay(date);

        calendarDay.cycleMarks.predictedPeriod =
          true;

        calendarDay.cycleDetails.push({
          type: "period",
          status: "predicted",
          cycleStartDate:
            cycle.cycleStartDate
        });
      }

      for (
        const date of cycle.fertileWindow.dates
      ) {
        const calendarDay =
          getCalendarDay(date);

        calendarDay.cycleMarks.fertile = true;

        calendarDay.cycleDetails.push({
          type: "fertile",
          status: "predicted",
          cycleStartDate:
            cycle.cycleStartDate
        });
      }

      if (
        !dayjs(cycle.ovulationDate).isBefore(
          rangeStart,
          "day"
        ) &&
        !dayjs(cycle.ovulationDate).isAfter(
          rangeEnd,
          "day"
        )
      ) {
        const calendarDay =
          getCalendarDay(
            cycle.ovulationDate
          );

        calendarDay.cycleMarks.ovulation =
          true;

        calendarDay.cycleDetails.push({
          type: "ovulation",
          status: "predicted",
          cycleStartDate:
            cycle.cycleStartDate
        });
      }

      for (const date of cycle.pmsWindow.dates) {
        const calendarDay =
          getCalendarDay(date);

        calendarDay.cycleMarks.pms = true;

        calendarDay.cycleDetails.push({
          type: "pms",
          status: "predicted",
          cycleStartDate:
            cycle.cycleStartDate
        });
      }
    }

    for (const healthLog of healthLogDates) {
      getCalendarDay(
        healthLog.date
      ).healthLogs.push(healthLog);
    }

    for (const planner of plannerDates) {
      getCalendarDay(
        planner.date
      ).planners.push(planner);
    }

    const calendarDays = Object.values(
      calendarMap
    ).sort(
      (first, second) =>
        first.date.localeCompare(second.date)
    );

    // ---------------------------------------------------------
    // 11. Group everything month-wise
    // ---------------------------------------------------------

    const months = {};

    let monthCursor =
      rangeStart.startOf("month");

    while (
      monthCursor.isBefore(rangeEnd, "month") ||
      monthCursor.isSame(rangeEnd, "month")
    ) {
      const monthKey =
        monthCursor.format("YYYY-MM");

      months[monthKey] = {
        month: monthKey,
        periodDates: [],
        confirmedPeriodDates: [],
        predictedPeriodDates: [],
        fertileDates: [],
        ovulationDates: [],
        pmsDates: [],
        healthLogDates: [],
        plannerDates: [],
        days: []
      };

      monthCursor =
        monthCursor.add(1, "month");
    }

    for (const day of calendarDays) {
      const monthData = months[day.month];

      if (!monthData) {
        continue;
      }

      if (
        day.cycleMarks.confirmedPeriod ||
        day.cycleMarks.predictedPeriod
      ) {
        monthData.periodDates.push(day.date);
      }

      if (day.cycleMarks.confirmedPeriod) {
        monthData.confirmedPeriodDates.push(
          day.date
        );
      }

      if (
        day.cycleMarks.predictedPeriod &&
        !day.cycleMarks.confirmedPeriod
      ) {
        monthData.predictedPeriodDates.push(
          day.date
        );
      }

      if (day.cycleMarks.fertile) {
        monthData.fertileDates.push(day.date);
      }

      if (day.cycleMarks.ovulation) {
        monthData.ovulationDates.push(day.date);
      }

      if (day.cycleMarks.pms) {
        monthData.pmsDates.push(day.date);
      }

      if (day.healthLogs.length > 0) {
        monthData.healthLogDates.push({
          date: day.date,
          logs: day.healthLogs
        });
      }

      if (day.planners.length > 0) {
        monthData.plannerDates.push({
          date: day.date,
          planners: day.planners
        });
      }

      monthData.days.push(day);
    }

    const selectedMonthData =
      month && months[month]
        ? months[month]
        : null;

    // ---------------------------------------------------------
    // 12. Final response
    // ---------------------------------------------------------

    return res.json({
      success: true,

      data: {
        range: {
          startDate:
            rangeStart.format("YYYY-MM-DD"),

          endDate:
            rangeEnd.format("YYYY-MM-DD"),

          previousMonths: 6,
          futureMonths: 12
        },

        cycleSummary: {
          lastPeriodDate:
            lastPeriod.format("YYYY-MM-DD"),

          effectiveCycleStart:
            effectiveCycleStart.format(
              "YYYY-MM-DD"
            ),

          bleedingDays,
          cycleLength,

          ovulationDate:
            ovulation.format("YYYY-MM-DD"),

          fertileWindow: {
            startDate:
              fertileStart.format(
                "YYYY-MM-DD"
              ),

            endDate:
              fertileEnd.format(
                "YYYY-MM-DD"
              )
          },

          nextPeriodDate:
            nextPeriod.format("YYYY-MM-DD"),

          pmsWindow: {
            startDate:
              pmsStart.format("YYYY-MM-DD"),

            endDate:
              pmsEnd.format("YYYY-MM-DD")
          },

          daysUntilNextPeriod,
          fertilityLevel,
          isOverdue
        },

        statistics: {
          averageCycleLength: cycleLength,
          regularity,
          regularityScore,
          totalCyclesTracked:
            history.length
        },

        history,

        confirmedPeriods,
        predictedCycles,

        healthLogDates,
        plannerDates,

        selectedMonthData
      }
    });
  } catch (error) {
    console.error(
      "getCycleCalendarDetails error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to fetch cycle calendar details",

      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
};


exports.saveMedicalHistory = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const medicalHistory = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID missing"
      });
    }

    if (
      !medicalHistory ||
      typeof medicalHistory !== "object" ||
      Array.isArray(medicalHistory)
    ) {
      return res.status(400).json({
        success: false,
        message: "Medical history must be a valid JSON object"
      });
    }

    const result = await db.query(
      `
      INSERT INTO user_medical_history (
        user_id,
        medical_history
      )
      VALUES ($1, $2::jsonb)

      ON CONFLICT (user_id)
      DO UPDATE SET
        medical_history = EXCLUDED.medical_history,
        updated_at = NOW()

      RETURNING
        id,
        user_id AS "userId",
        medical_history AS "medicalHistory",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [
        userId,
        JSON.stringify(medicalHistory)
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Medical history saved successfully",
      data: result.rows[0]
    });
  } catch (error) {
    console.error("Save medical history error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save medical history"
    });
  }
};

exports.getMedicalHistory = async (req, res) => {
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
      SELECT
        id,
        user_id,
        medical_history,
        created_at,
        updated_at
      FROM user_medical_history
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Medical history not found",
        data: {}
      });
    }

    return res.status(200).json({
      success: true,
      message: "Medical history fetched successfully",
      data: result.rows[0].medical_history
    });

  } catch (error) {
    console.error("Get medical history error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch medical history"
    });
  }
};
