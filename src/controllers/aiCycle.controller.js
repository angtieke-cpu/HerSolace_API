const dayjs = require("dayjs");
const db = require("../db");
const OpenAI = require("openai");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});



exports.getAiCycleInsights = async (req, res) => {
    try {
        const userId = req.user.userId;

        if (!userId) {
            return res.status(400).json({
                message: "userid header required"
            });
        }

        // ✅ 1. Get latest cycle data
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
                message: "No period log found"
            });
        }

        const {
            last_period_date,
            cycle_length_days,
            bleeding_days
        } = result.rows[0];

        // ✅ 2. Indian timezone date logic
        const today = dayjs().tz("Asia/Kolkata");

        const startDate = dayjs(last_period_date)
            .tz("Asia/Kolkata");

        // ✅ Actual elapsed days
        const diffDays = today.diff(startDate, "day") + 1;

        // ✅ Delay logic
        let adjustedCycleLength =
            Number(cycle_length_days) || 28;

        let delayDays = 0;

        if (diffDays > adjustedCycleLength) {
            delayDays =
                diffDays - adjustedCycleLength;

            adjustedCycleLength =
                adjustedCycleLength + delayDays;
        }

        // ✅ Current cycle day
        const currentDay =
            ((diffDays - 1) % adjustedCycleLength) + 1;

        // ✅ Determine phase
        let phase = "";

        if (currentDay <= bleeding_days) {
            phase = "Menstrual";
        } else if (currentDay <= 13) {
            phase = "Follicular";
        } else if (currentDay === 14) {
            phase = "Ovulation";
        } else {
            phase = "Luteal";
        }

        // ✅ 3. Check cache
        const cache = await db.query(
            `
      SELECT * FROM ai_cycle_insights_cache
      WHERE cycle_day = $1
      AND cycle_length_days = $2
      `,
            [currentDay, adjustedCycleLength]
        );

        if (cache.rows.length > 0) {
            return res.json({
                success: true,
                cycleDay: currentDay,
                delayDays,
                adjustedCycleLength,
                source: "cache",
                aiInsights: {
                    exerciseOptimization:
                        cache.rows[0].exercise_optimization,

                    nutritionGuidance:
                        cache.rows[0].nutrition_guidance,

                    sleepPattern:
                        cache.rows[0].sleep_pattern,

                    symptomsForecast:
                        cache.rows[0].symptoms_forecast
                }
            });
        }

        // ✅ 4. AI Prompt
        const prompt = `
User menstrual cycle details:

- Current cycle day: ${currentDay}
- Cycle length: ${adjustedCycleLength} days
- Bleeding duration: ${bleeding_days} days
- Current phase: ${phase}
- Delay days: ${delayDays}

Provide personalized wellness guidance in JSON format.

Required JSON structure:
{
  "exerciseOptimization": "",
  "nutritionGuidance": "",
  "sleepPattern": "",
  "symptomsForecast": ""
}

Guidelines:
- Tailor advice based on cycle phase
- Consider hormonal changes
- Keep responses concise and actionable
`;

        // ✅ 5. Call AI
        const response =
            await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.6
            });

        const aiOutput =
            response.choices[0].message.content;

        const clean =
            aiOutput.replace(/```json|```/g, "");

        const parsed = JSON.parse(clean);

        // ✅ 6. Save cache
        await db.query(
            `
      INSERT INTO ai_cycle_insights_cache (
        cycle_day,
        cycle_length_days,
        exercise_optimization,
        nutrition_guidance,
        sleep_pattern,
        symptoms_forecast
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      `,
            [
                currentDay,
                adjustedCycleLength,
                parsed.exerciseOptimization,
                parsed.nutritionGuidance,
                parsed.sleepPattern,
                parsed.symptomsForecast
            ]
        );

        // ✅ 7. Response
        return res.json({
            success: true,
            cycleDay: currentDay,
            delayDays,
            adjustedCycleLength,
            source: "ai",
            aiInsights: parsed
        });

    } catch (error) {
        console.error("AI cycle error:", error);

        return res.status(500).json({
            message: "AI cycle prediction failed"
        });
    }
};

exports.getAiCycleInsightsWithInput = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { userInput } = req.body;

        if (!userId) {
            return res.status(400).json({
                message: "userid header required"
            });
        }

        if (!userInput) {
            return res.status(400).json({
                message: "userInput is required"
            });
        }

        // ✅ Get latest cycle data
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

        if (!result.rows.length) {
            return res.status(404).json({
                message: "No period log found"
            });
        }

        const {
            last_period_date,
            cycle_length_days,
            bleeding_days
        } = result.rows[0];

        // ✅ Indian timezone
        const today = dayjs().tz("Asia/Kolkata");

        const startDate = dayjs(last_period_date)
            .tz("Asia/Kolkata");

        // ✅ Actual elapsed days
        const diffDays =
            today.diff(startDate, "day") + 1;

        // ✅ Delay logic
        let adjustedCycleLength =
            Number(cycle_length_days) || 28;

        let delayDays = 0;

        if (diffDays > adjustedCycleLength) {
            delayDays =
                diffDays - adjustedCycleLength;

            adjustedCycleLength =
                adjustedCycleLength + delayDays;
        }

        // ✅ Current cycle day
        const currentDay =
            ((diffDays - 1) % adjustedCycleLength) + 1;

        // ✅ Phase logic
        let phase = "";

        const ovulationDay = Math.floor(
            adjustedCycleLength / 2
        );

        if (currentDay <= bleeding_days) {
            phase = "Menstrual";

        } else if (currentDay < ovulationDay - 2) {
            phase = "Follicular";

        } else if (
            currentDay >= ovulationDay - 2 &&
            currentDay <= ovulationDay + 2
        ) {
            phase = "Ovulation";

        } else if (
            currentDay > ovulationDay + 2 &&
            currentDay <= adjustedCycleLength
        ) {
            phase = "Luteal";

        } else {
            phase = "Delayed";
        }

        // ✅ Prompt
        const prompt = `
User cycle context:

- Current cycle day: ${currentDay}
- Current phase: ${phase}
- Cycle length: ${adjustedCycleLength} days
- Bleeding duration: ${bleeding_days} days
- Delay days: ${delayDays}

User query:
"${userInput}"

Instructions:
- Give supportive wellness guidance
- Keep answer concise
- 2–4 lines maximum
- Plain text only
- No JSON
`;

        // ✅ AI Call
        const response =
            await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7
            });

        const answer =
            response.choices[0].message.content.trim();

        // ✅ Final response
        return res.json({
            success: true,
            cycleDay: currentDay,
            phase,
            delayDays,
            adjustedCycleLength,
            answer
        });

    } catch (error) {
        console.error("AI error:", error);

        return res.status(500).json({
            message: "AI response failed"
        });
    }
};

exports.getCycleTripPlannerInsights = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userid required"
      });
    }

    const {
      startDate,
      endDate,
      purpose = "Travel",
      activity = "General"
    } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "startDate and endDate are required"
      });
    }

    const requestedStart = dayjs(startDate).startOf("day");
    const requestedEnd = dayjs(endDate).startOf("day");

    if (!requestedStart.isValid() || !requestedEnd.isValid()) {
      return res.status(400).json({
        success: false,
        message: "Invalid startDate or endDate"
      });
    }

    if (requestedEnd.isBefore(requestedStart, "day")) {
      return res.status(400).json({
        success: false,
        message: "endDate cannot be before startDate"
      });
    }

    const formattedStartDate =
      requestedStart.format("YYYY-MM-DD");

    const formattedEndDate =
      requestedEnd.format("YYYY-MM-DD");

    const normalizedPurpose =
      String(purpose || "Travel").trim() || "Travel";

    const normalizedActivity =
      String(activity || "General").trim() || "General";

    /*
     * Local helper: calculate cycle day for any date.
     */
    const calculateCycleDay = (
      selectedDate,
      latestPeriodDate,
      cycleLength
    ) => {
      const selected = dayjs(selectedDate).startOf("day");
      const latest = dayjs(latestPeriodDate).startOf("day");

      const difference = selected.diff(latest, "day");

      const normalizedDifference =
        ((difference % cycleLength) + cycleLength) %
        cycleLength;

      return normalizedDifference + 1;
    };

    /*
     * Local helper: determine phase.
     */
    const calculatePhase = (
      cycleDay,
      cycleLength,
      bleedingDays
    ) => {
      const ovulationCycleDay = cycleLength - 14;

      if (cycleDay <= bleedingDays) {
        return "Menstrual";
      }

      if (cycleDay < ovulationCycleDay) {
        return "Follicular";
      }

      if (cycleDay === ovulationCycleDay) {
        return "Ovulation";
      }

      return "Luteal";
    };

    /*
     * Local helper: generate day-wise information.
     */
    const generateDayWiseAnalysis = ({
      rangeStart,
      rangeEnd,
      latestPeriodDate,
      cycleLength,
      bleedingDays,
      plannerStartDate
    }) => {
      const dayWiseAnalysis = [];

      let currentDate = dayjs(rangeStart).startOf("day");
      const finalDate = dayjs(rangeEnd).startOf("day");

      const ovulationCycleDay = cycleLength - 14;
      const fertileStartCycleDay =
        ovulationCycleDay - 5;
      const fertileEndCycleDay =
        ovulationCycleDay + 1;

      while (
        currentDate.isBefore(finalDate, "day") ||
        currentDate.isSame(finalDate, "day")
      ) {
        const cycleDay = calculateCycleDay(
          currentDate,
          latestPeriodDate,
          cycleLength
        );

        const phase = calculatePhase(
          cycleDay,
          cycleLength,
          bleedingDays
        );

        const isPeriodDay =
          cycleDay <= bleedingDays;

        const isOvulationDay =
          cycleDay === ovulationCycleDay;

        const isFertileDay =
          cycleDay >= fertileStartCycleDay &&
          cycleDay <= fertileEndCycleDay;

        const isPmsDay =
          cycleDay >= cycleLength - 4 &&
          cycleDay <= cycleLength;

        const tripDay =
          currentDate.diff(
            dayjs(plannerStartDate).startOf("day"),
            "day"
          ) + 1;

        dayWiseAnalysis.push({
          date: currentDate.format("YYYY-MM-DD"),
          cycleDay,
          phase,
          tripDay,
          isPeriodDay,
          isOvulationDay,
          isFertileDay,
          isPmsDay,
          isRequestedStartDate: currentDate.isSame(
            requestedStart,
            "day"
          ),
          isRequestedEndDate: currentDate.isSame(
            requestedEnd,
            "day"
          )
        });

        currentDate = currentDate.add(1, "day");
      }

      return dayWiseAnalysis;
    };

    /*
     * FLOW 1:
     * Check whether the selected range is already covered
     * by an existing saved planner.
     *
     * Examples:
     *
     * Saved:    July 10 to July 20
     * Requested July 15              -> existing
     * Requested July 13 to July 17   -> existing
     * Requested July 10 to July 20   -> exact
     * Requested July 18 to July 25   -> new AI call
     */
    const existingPlannerResult = await db.query(
      `
      SELECT
        id,
        start_date,
        end_date,
        purpose,
        activity,
        latest_period_date,
        cycle_length,
        bleeding_days,
        ai_insights,
        created_at,
        updated_at,

        CASE
          WHEN start_date = $2::date
           AND end_date = $3::date
          THEN true
          ELSE false
        END AS is_exact_match

      FROM cycle_trip_planner_insights

      WHERE user_id = $1
        AND start_date <= $2::date
        AND end_date >= $3::date

      ORDER BY
        is_exact_match DESC,
        (end_date - start_date) ASC,
        created_at DESC

      LIMIT 1
      `,
      [
        userId,
        formattedStartDate,
        formattedEndDate
      ]
    );

    /*
     * Existing exact date or inside existing date range.
     * AI is not called.
     */
    if (existingPlannerResult.rows.length > 0) {
      const savedPlanner =
        existingPlannerResult.rows[0];

      const cycleLength =
        Number(savedPlanner.cycle_length) || 28;

      const bleedingDays =
        Number(savedPlanner.bleeding_days) || 5;

      const dayWiseAnalysis =
        generateDayWiseAnalysis({
          rangeStart: requestedStart,
          rangeEnd: requestedEnd,
          latestPeriodDate:
            savedPlanner.latest_period_date,
          cycleLength,
          bleedingDays,
          plannerStartDate: savedPlanner.start_date
        });

      return res.json({
        success: true,
        aiGenerated: false,
        source: "database",

        matchType: savedPlanner.is_exact_match
          ? "exact_match"
          : "inside_existing_planner",

        message: savedPlanner.is_exact_match
          ? "Existing planner retrieved"
          : "Requested date is covered by an existing planner",

        data: {
          plannerId: savedPlanner.id,

          savedPlanner: {
            startDate: savedPlanner.start_date,
            endDate: savedPlanner.end_date,
            purpose: savedPlanner.purpose,
            activity: savedPlanner.activity
          },

          requestedPlanner: {
            startDate: formattedStartDate,
            endDate: formattedEndDate,
            purpose: normalizedPurpose,
            activity: normalizedActivity
          },

          cycleAnalysis: {
            latestPeriodDate:
              savedPlanner.latest_period_date,
            cycleLength,
            bleedingDays
          },

          dayWiseAnalysis,

          aiInsights: savedPlanner.ai_insights,

          createdAt: savedPlanner.created_at,
          updatedAt: savedPlanner.updated_at
        }
      });
    }

    /*
     * FLOW 2:
     * No saved planner covers the requested range.
     * Retrieve cycle history.
     */
    const historyResult = await db.query(
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

    if (historyResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No cycle data found"
      });
    }

    const history = historyResult.rows;

    /*
     * Calculate average cycle length.
     */
    let cycleLength = 28;

    if (history.length > 1) {
      let totalDays = 0;
      let validCycleCount = 0;

      for (let index = 1; index < history.length; index++) {
        const difference = dayjs(
          history[index].period_date
        ).diff(
          dayjs(history[index - 1].period_date),
          "day"
        );

        /*
         * Ignore clearly incorrect cycle gaps.
         */
        if (difference >= 15 && difference <= 60) {
          totalDays += difference;
          validCycleCount++;
        }
      }

      if (validCycleCount > 0) {
        cycleLength = Math.round(
          totalDays / validCycleCount
        );
      } else {
        cycleLength =
          Number(
            history[history.length - 1].cycle_length
          ) || 28;
      }
    } else {
      cycleLength =
        Number(history[0].cycle_length) || 28;
    }

    const latestLog =
      history[history.length - 1];

    const latestPeriodDate = dayjs(
      latestLog.period_date
    ).startOf("day");

    const bleedingDays =
      Number(latestLog.bleeding_days) || 5;

    /*
     * Calculate effective cycle containing the requested
     * start date.
     */
    const daysFromLatestPeriod =
      requestedStart.diff(latestPeriodDate, "day");

    const completedCycles =
      daysFromLatestPeriod >= 0
        ? Math.floor(daysFromLatestPeriod / cycleLength)
        : 0;

    const effectiveCycleStart =
      latestPeriodDate.add(
        completedCycles * cycleLength,
        "day"
      );

    const startCycleDay = calculateCycleDay(
      requestedStart,
      latestPeriodDate,
      cycleLength
    );

    const startPhase = calculatePhase(
      startCycleDay,
      cycleLength,
      bleedingDays
    );

    const ovulationCycleDay =
      cycleLength - 14;

    const ovulationDate =
      effectiveCycleStart.add(
        ovulationCycleDay - 1,
        "day"
      );

    const fertileStart =
      ovulationDate.subtract(5, "day");

    const fertileEnd =
      ovulationDate.add(1, "day");

    const nextPeriod =
      effectiveCycleStart.add(
        cycleLength,
        "day"
      );

    const pmsStart =
      nextPeriod.subtract(5, "day");

    const pmsEnd =
      nextPeriod.subtract(1, "day");

    /*
     * Generate cycle details for every requested date.
     */
    const dayWiseAnalysis =
      generateDayWiseAnalysis({
        rangeStart: requestedStart,
        rangeEnd: requestedEnd,
        latestPeriodDate,
        cycleLength,
        bleedingDays,
        plannerStartDate: requestedStart
      });

    /*
     * AI is called only for a completely new date range.
     */
    const prompt = `
You are a women's wellness cycle planning assistant.

Cycle history:
${JSON.stringify(history, null, 2)}

Average cycle length:
${cycleLength} days

Bleeding duration:
${bleedingDays} days

Planner details:

Start date:
${formattedStartDate}

End date:
${formattedEndDate}

Purpose:
${normalizedPurpose}

Activity:
${normalizedActivity}

Cycle position on the selected start date:

Cycle day:
${startCycleDay}

Cycle phase:
${startPhase}

Predicted ovulation:
${ovulationDate.format("YYYY-MM-DD")}

Predicted fertile window:
${fertileStart.format("YYYY-MM-DD")} to ${fertileEnd.format("YYYY-MM-DD")}

Predicted next period:
${nextPeriod.format("YYYY-MM-DD")}

Predicted PMS window:
${pmsStart.format("YYYY-MM-DD")} to ${pmsEnd.format("YYYY-MM-DD")}

Day-wise cycle analysis:
${JSON.stringify(dayWiseAnalysis, null, 2)}

Provide practical wellness and planning guidance.

Return valid JSON only using this structure:

{
  "tripSuitability": "",
  "cycleImpact": "",
  "expectedSymptoms": [],
  "travelPreparation": [],
  "recommendedActivities": [],
  "thingsToAvoid": [],
  "periodManagementTips": [],
  "bestAdvice": ""
}

Do not include markdown.
Do not provide a medical diagnosis.
`;

    const aiResponse =
      await openai.chat.completions.create({
        model: "gpt-4o-mini",

        messages: [
          {
            role: "system",
            content:
              "Return only valid JSON without markdown code blocks."
          },
          {
            role: "user",
            content: prompt
          }
        ],

        temperature: 0.6,

        response_format: {
          type: "json_object"
        }
      });

    const aiContent =
      aiResponse.choices?.[0]?.message?.content;

    if (!aiContent) {
      throw new Error("AI returned an empty response");
    }

    let aiInsights;

    try {
      const cleanedContent = aiContent
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      aiInsights = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error(
        "Invalid AI response:",
        aiContent
      );

      throw new Error(
        "AI returned invalid JSON"
      );
    }

    /*
     * Save the newly generated planner.
     */
    const insertResult = await db.query(
      `
      INSERT INTO cycle_trip_planner_insights (
        user_id,
        start_date,
        end_date,
        purpose,
        activity,
        latest_period_date,
        cycle_length,
        bleeding_days,
        ai_insights,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING *
      `,
      [
        userId,
        formattedStartDate,
        formattedEndDate,
        normalizedPurpose,
        normalizedActivity,
        latestPeriodDate.format("YYYY-MM-DD"),
        cycleLength,
        bleedingDays,
        JSON.stringify(aiInsights)
      ]
    );

    const savedPlanner = insertResult.rows[0];

    return res.status(201).json({
      success: true,
      aiGenerated: true,
      source: "ai",
      matchType: "new_planner",
      message:
        "Planner insights generated and saved",

      data: {
        plannerId: savedPlanner.id,

        requestedPlanner: {
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          purpose: normalizedPurpose,
          activity: normalizedActivity
        },

        cycleAnalysis: {
          latestPeriodDate:
            latestPeriodDate.format("YYYY-MM-DD"),

          effectiveCycleStart:
            effectiveCycleStart.format("YYYY-MM-DD"),

          cycleLength,
          bleedingDays,
          startCycleDay,
          startPhase,

          ovulation:
            ovulationDate.format("YYYY-MM-DD"),

          fertileWindow: {
            startDate:
              fertileStart.format("YYYY-MM-DD"),
            endDate:
              fertileEnd.format("YYYY-MM-DD")
          },

          nextPeriod:
            nextPeriod.format("YYYY-MM-DD"),

          pmsWindow: {
            startDate:
              pmsStart.format("YYYY-MM-DD"),
            endDate:
              pmsEnd.format("YYYY-MM-DD")
          }
        },

        dayWiseAnalysis,
        aiInsights
      }
    });
  } catch (error) {
    console.error(
      "Cycle trip planner error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Trip planning failed",
      error: "Cycle trip planner error"
    });
  }
};
