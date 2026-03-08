const dayjs = require("dayjs");
const db = require("../db");
const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

exports.getAiCycleInsights = async (req, res) => {
  try {

    const userId = req.user.userid;

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

    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    });

    const aiResponse = completion.choices[0].message.content;

    res.json({
      success: true,
      cycleDay: currentDay,
      aiInsights: aiResponse
    });

  } catch (error) {
    console.error("AI cycle error:", error);

    res.status(500).json({
      message: "AI cycle prediction failed"
    });
  }
};