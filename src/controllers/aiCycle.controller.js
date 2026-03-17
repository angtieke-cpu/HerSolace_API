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

    const result = await db.query(
      `SELECT last_period_date, cycle_length_days
       FROM journey_details
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Journey data not found"
      });
    }

    const { last_period_date, cycle_length_days } = result.rows[0];

    const today = dayjs();
    const startDate = dayjs(last_period_date);

    const diffDays = today.diff(startDate, "day");
    const currentDay = (diffDays % cycle_length_days) + 1;

    // 1️⃣ Check cache table first
    const cache = await db.query(
      `SELECT * FROM ai_cycle_insights_cache
       WHERE cycle_day = $1
       AND cycle_length_days = $2`,
      [currentDay, cycle_length_days]
    );

    if (cache.rows.length > 0) {
      return res.json({
        success: true,
        cycleDay: currentDay,
        source: "cache",
        aiInsights: {
          exerciseOptimization: cache.rows[0].exercise_optimization,
          nutritionGuidance: cache.rows[0].nutrition_guidance,
          sleepPattern: cache.rows[0].sleep_pattern,
          symptomsForecast: cache.rows[0].symptoms_forecast
        }
      });
    }

    // 2️⃣ If not cached → call AI
    const prompt = `
    User menstrual cycle day: ${currentDay}

    Provide personalized wellness guidance in JSON format.

    Required JSON structure:
    {
      "exerciseOptimization": "",
      "nutritionGuidance": "",
      "sleepPattern": "",
      "symptomsForecast": ""
    }

    Keep responses concise and helpful.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6
    });

    const aiOutput = response.choices[0].message.content;
    const clean = aiOutput.replace(/```json|```/g, "");
    const parsed = JSON.parse(clean);

    // 3️⃣ Save result to cache
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
        cycle_length_days,
        parsed.exerciseOptimization,
        parsed.nutritionGuidance,
        parsed.sleepPattern,
        parsed.symptomsForecast
      ]
    );

    res.json({
      success: true,
      cycleDay: currentDay,
      source: "ai",
      aiInsights: parsed
    });

  } catch (error) {
    console.error("AI cycle error:", error);

    res.status(500).json({
      message: "AI cycle prediction failed"
    });
  }
};