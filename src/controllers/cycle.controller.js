const db = require("../db");
const { calculateCycle } = require("../utils/cycleCalculator");
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

        // 2️⃣ Calculate delay-based cycle adjustment

        const today = new Date(
            new Date().toLocaleString("en-US", {
                timeZone: "Asia/Kolkata",
            })
        );

        const lastPeriodDate = new Date(
            new Date(last_period_date).toLocaleString("en-US", {
                timeZone: "Asia/Kolkata",
            })
        );

        // Normalize both dates
        today.setHours(0, 0, 0, 0);
        lastPeriodDate.setHours(0, 0, 0, 0);

        // Difference
        const diffTime =
            today.getTime() - lastPeriodDate.getTime();

        const diffDays =
            Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;

        let adjustedCycleLength =
            Number(cycle_length_days) || 28;

        let delayDays = 0;

        // 👉 If user missed logging
        if (diffDays > adjustedCycleLength) {
            delayDays =
                diffDays - adjustedCycleLength;

            adjustedCycleLength =
                adjustedCycleLength + delayDays;
        }
        // 3️⃣ Calculate cycle

        const cycleData = calculateCycle({
            lastPeriodDate: lastPeriodDate,
            cycleLength: adjustedCycleLength,
            bleedingDays: bleeding_days,
        });

        const { phase, stage, currentDay } = cycleData;





        // 4️⃣ OLD TABLE (minimal fields)
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

        // 5️⃣ NEW TABLE (range + stage match)
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


        const cycleGuide = {
            ...(oldGuide.rows[0] || {}),
            ...(newGuide.rows[0] || {}),
        };

        // 6️⃣ Response
        res.json({
            success: true,
            data: {
                username: name,

                ...cycleData,
                delayDays,


                adjustedCycleLength,





                cycleGuide,
            },
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
            return res.status(400).json({ message: "userid header required" });
        }

        if (!periodDate) {
            return res.status(400).json({ message: "periodDate required" });
        }

        const newDate = dayjs(periodDate);

        // ✅ 1. Get past records
        const prevResult = await db.query(
            `
      SELECT period_date, bleeding_days
      FROM user_period_log
      WHERE user_id = $1
      ORDER BY period_date DESC
      LIMIT 6
      `,
            [userId]
        );

        const rows = prevResult.rows;

        let cycle_length = null;
        let bleeding_days = null;

        // ✅ 2. Calculate cycle length (NO DEFAULT)
        if (rows.length >= 1) {
            let diffs = [];

            // include new entry vs latest record
            const latestDate = dayjs(rows[0].period_date);
            const newDiff = newDate.diff(latestDate, "day");

            if (newDiff > 0) {
                diffs.push(newDiff);
            }

            // previous diffs
            for (let i = 0; i < rows.length - 1; i++) {
                const d1 = dayjs(rows[i].period_date);
                const d2 = dayjs(rows[i + 1].period_date);

                const diff = d1.diff(d2, "day");

                if (diff > 0) {
                    diffs.push(diff);
                }
            }

            if (diffs.length > 0) {
                const avg =
                    diffs.reduce((a, b) => a + b, 0) / diffs.length;

                cycle_length = Math.round(avg);
            }
        }

        // ✅ 3. Calculate bleeding_days (NO DEFAULT)
        const bleedValues = rows
            .map(r => r.bleeding_days)
            .filter(v => v !== null && v > 0);

        if (bleedValues.length > 0) {
            const avgBleed =
                bleedValues.reduce((a, b) => a + b, 0) / bleedValues.length;

            bleeding_days = Math.round(avgBleed);
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
      SELECT id
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

            updates.push(
                `period_date=$${index++}`
            );

            values.push(periodDate);

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

exports.getPreviousCycleandPredictionDetails = async (req, res) => {

    try {

        const userId = req.user.userId;


        if (!userId) {
            return res.status(400).json({
                message: "userId required"
            });
        }



        // Fetch cycle history
        const result = await db.query(
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



        if (result.rows.length === 0) {

            return res.json({

                success: true,

                data: {
                    history: [],
                    current_cycle: null,
                    predictions: null,

                    statistics: {
                        average_cycle_length: 28,
                        regularity: "—",
                        regularity_score: 0,
                        total_cycles_tracked: 0
                    }

                }

            });

        }




        // Format history
        const history = result.rows.map(row => ({

            id: row.id,

            period_date:
                dayjs(row.period_date)
                    .format("YYYY-MM-DD"),

            bleeding_days:
                row.bleeding_days,

            cycle_length:
                row.cycle_length ?? null

        }));





        // ----------------------------
        // Cycle Length Calculation
        // SAME AS FRONTEND
        // ----------------------------

        let cycleLength = 28;


        if (history.length === 1) {

            cycleLength =
                history[0].cycle_length || 28;

        }


        if (history.length > 1) {

            let total = 0;


            for (let i = 1; i < history.length; i++) {

                total += dayjs(
                    history[i].period_date
                )
                    .diff(
                        dayjs(history[i - 1].period_date),
                        "day"
                    );

            }


            cycleLength =
                Math.round(
                    total / (history.length - 1)
                );

        }




        const lastRecord =
            history[history.length - 1];


        const lastPeriod =
            dayjs(lastRecord.period_date);



        const bleedingDays =
            lastRecord.bleeding_days || 5;






        // ----------------------------
        // Today IST
        // ----------------------------

        const today =
            dayjs()
                .tz("Asia/Kolkata")
                .startOf("day");






        // ----------------------------
        // Effective Cycle Start
        // SAME AS FRONTEND
        // ----------------------------

        let effectiveCycleStart =
            lastPeriod;



        while (
            effectiveCycleStart
                .add(cycleLength, "day")
                .isBefore(today)
        ) {

            effectiveCycleStart =
                effectiveCycleStart
                    .add(cycleLength, "day");

        }





        // ----------------------------
        // Cycle Predictions
        // ----------------------------


        const ovulation =
            effectiveCycleStart
                .add(
                    cycleLength - 14,
                    "day"
                );



        const fertileStart =
            ovulation
                .subtract(5, "day");



        const fertileEnd =
            ovulation;



        const rawNextPeriod =
            effectiveCycleStart
                .add(
                    cycleLength,
                    "day"
                );



        const firstExpectedPeriod =
            lastPeriod
                .add(
                    cycleLength,
                    "day"
                );



        const isOverdue =
            firstExpectedPeriod.isBefore(today);



        const nextPeriod =
            isOverdue
                ?
                today.add(1, "day")
                :
                rawNextPeriod;





        const pmsStart =
            nextPeriod.subtract(5, "day");


        const pmsEnd =
            nextPeriod.subtract(1, "day");





        const daysUntilNextPeriod =
            nextPeriod.diff(
                today,
                "day"
            );






        // ----------------------------
        // Fertility Level
        // SAME AS FRONTEND
        // ----------------------------


        let fertilityLevel = "Low";


        if (
            today.format("YYYY-MM-DD")
            ===
            ovulation.format("YYYY-MM-DD")
        ) {

            fertilityLevel = "Peak";

        }
        else if (

            (
                today.isAfter(
                    fertileStart
                )
                ||
                today.isSame(
                    fertileStart
                )
            )
            &&
            (
                today.isBefore(
                    fertileEnd
                )
                ||
                today.isSame(
                    fertileEnd
                )
            )

        ) {

            fertilityLevel = "High";

        }








        // ----------------------------
        // Regularity Calculation
        // SAME AS FRONTEND
        // ----------------------------


        let regularity = "—";
        let regularityScore = 0;



        if (history.length >= 2) {

            let diffs = [];


            for (let i = 1; i < history.length; i++) {

                diffs.push(

                    dayjs(
                        history[i].period_date
                    )
                        .diff(
                            dayjs(history[i - 1].period_date),
                            "day"
                        )

                );

            }



            const avg =
                diffs.reduce(
                    (a, b) => a + b,
                    0
                )
                /
                diffs.length;



            const variance =
                diffs.reduce(
                    (sum, value) =>
                        sum +
                        Math.abs(value - avg),
                    0
                )
                /
                diffs.length;



            regularity =
                variance <= 2
                    ?
                    "Regular"
                    :
                    "Irregular";



            regularityScore =
                Math.max(
                    0,
                    Math.min(
                        100,
                        Math.round(
                            100 - (variance * 8)
                        )
                    )
                );


        }





        // ----------------------------
        // Future Cycles
        // SAME AS FRONTEND 12 cycles
        // ----------------------------


        const futureCycles = [];



        for (let i = 0; i < 12; i++) {


            const period =
                nextPeriod
                    .add(
                        i * cycleLength,
                        "day"
                    );



            const futureOvulation =
                period
                    .add(
                        cycleLength - 14,
                        "day"
                    );



            futureCycles.push({

                period_date:
                    period.format("YYYY-MM-DD"),


                ovulation_date:
                    futureOvulation.format("YYYY-MM-DD"),


                fertile_start:
                    futureOvulation
                        .subtract(5, "day")
                        .format("YYYY-MM-DD"),


                fertile_end:
                    futureOvulation
                        .format("YYYY-MM-DD")

            });


        }







        // ----------------------------
        // FINAL RESPONSE
        // ----------------------------


        return res.json({

            success: true,


            data: {


                history,



                current_cycle: {


                    last_period_date:
                        lastPeriod.format("YYYY-MM-DD"),


                    bleeding_days:
                        bleedingDays,


                    cycle_length:
                        cycleLength,



                    ovulation_date:
                        ovulation.format("YYYY-MM-DD"),



                    fertile_window: {

                        start:
                            fertileStart.format("YYYY-MM-DD"),


                        end:
                            fertileEnd.format("YYYY-MM-DD")

                    },



                    next_period_date:
                        nextPeriod.format("YYYY-MM-DD"),



                    pms_window: {


                        start:
                            pmsStart.format("YYYY-MM-DD"),


                        end:
                            pmsEnd.format("YYYY-MM-DD")

                    }


                },



                predictions: {


                    next_period_date:
                        nextPeriod.format("YYYY-MM-DD"),



                    days_until_next_period:
                        daysUntilNextPeriod,



                    fertility_level:
                        fertilityLevel,



                    future_cycles:
                        futureCycles

                },




                statistics: {


                    average_cycle_length:
                        cycleLength,


                    regularity,


                    regularity_score:
                        regularityScore,


                    total_cycles_tracked:
                        history.length

                }


            }


        });



    }
    catch (error) {

        console.error(
            "getPreviousCycleDetails Error:",
            error
        );


        return res.status(500).json({

            message:
                "Failed to fetch cycle details"

        });

    }

};
