const dayjs = require("dayjs");
const db = require("../db");
const OpenAI = require("openai");

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

    // ✅ Calculate cycle day
    const today = dayjs();
    const startDate = dayjs(last_period_date);

    const diffDays = today.diff(startDate, "day");
    const currentDay = (diffDays % cycle_length_days) + 1;

    // ✅ Phase logic
    let phase = "";
    if (currentDay <= bleeding_days) phase = "Menstrual";
    else if (currentDay <= 13) phase = "Follicular";
    else if (currentDay === 14) phase = "Ovulation";
    else phase = "Luteal";

    // ✅ Prompt
    const prompt = `
User cycle context:
Day ${currentDay} (${phase} phase), cycle length ${cycle_length_days} days, bleeding ${bleeding_days} days.

User query:
"${userInput}"

Give a short, helpful answer (2–4 lines max).
No JSON. Plain text only.
`;

    // ✅ AI Call
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const answer = response.choices[0].message.content.trim();

    // ✅ Final response (NO DB SAVE)
    res.json({
      success: true,
      cycleDay: currentDay,
      phase,
      answer
    });

  } catch (error) {
    console.error("AI error:", error);
    res.status(500).json({ message: "AI response failed" });
  }
};
