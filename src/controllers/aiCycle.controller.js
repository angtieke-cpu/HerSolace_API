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


        const userId = req.user.userId;


        if (!userId) {

            return res.status(400).json({
                message: "userid required"
            });

        }



        const {
            startDate,
            endDate,
            purpose,
            activity
        } = req.body;




        if (!startDate || !endDate) {

            return res.status(400).json({
                message: "Trip dates required"
            });

        }




        // --------------------------------
        // Get complete cycle history
        // --------------------------------


        const result = await db.query(
            `
SELECT
 id,
 period_date,
 bleeding_days,
 cycle_length
FROM user_period_log
WHERE user_id=$1
ORDER BY period_date ASC
`,
            [userId]
        );



        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "No cycle data found"
            });

        }





        const history = result.rows;




        // --------------------------------
        // Calculate average cycle
        // --------------------------------


        let cycleLength = 28;


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
        else {

            cycleLength =
                history[0].cycle_length || 28;

        }





        const latest =
            dayjs(
                history[history.length - 1].period_date
            );



        const bleedingDays =
            history[history.length - 1].bleeding_days || 5;





        // --------------------------------
        // Trip cycle position
        // --------------------------------


        const tripStart =
            dayjs(startDate);



        const daysFromLastPeriod =
            tripStart.diff(
                latest,
                "day"
            ) + 1;



        const cycleDay =
            ((daysFromLastPeriod - 1)
                %
                cycleLength) + 1;





        let phase = "";


        if (cycleDay <= bleedingDays) {

            phase = "Menstrual";

        }
        else if (cycleDay <= 13) {

            phase = "Follicular";

        }
        else if (cycleDay === 14) {

            phase = "Ovulation";

        }
        else {

            phase = "Luteal";

        }







        // --------------------------------
        // Prediction dates
        // --------------------------------


        const ovulationDay =
            latest.add(
                cycleLength - 14,
                "day"
            );



        const fertileStart =
            ovulationDay.subtract(
                5,
                "day"
            );



        const nextPeriod =
            latest.add(
                cycleLength,
                "day"
            );




        const pmsStart =
            nextPeriod.subtract(
                5,
                "day"
            );




        const pmsEnd =
            nextPeriod.subtract(
                1,
                "day"
            );






        // --------------------------------
        // AI Prompt
        // --------------------------------



        const prompt = `

You are a women's wellness cycle planning assistant.


User menstrual cycle information:

Cycle History:

${JSON.stringify(history, null, 2)}


Average cycle length:
${cycleLength} days


Bleeding duration:
${bleedingDays} days



Trip/Event Details:

Start Date:
${startDate}

End Date:
${endDate}

Purpose:
${purpose || "Travel"}

Activity:
${activity || "General"}



Cycle position during trip:

Cycle Day:
${cycleDay}

Current Phase:
${phase}



Important predicted dates:

Ovulation:
${ovulationDay.format("YYYY-MM-DD")}

Fertile Window:
${fertileStart.format("YYYY-MM-DD")}
to
${ovulationDay.format("YYYY-MM-DD")}


Next Period:
${nextPeriod.format("YYYY-MM-DD")}


PMS Window:
${pmsStart.format("YYYY-MM-DD")}
to
${pmsEnd.format("YYYY-MM-DD")}



Provide personalized travel guidance.

Return JSON only:


{
 "tripSuitability":"",
 "cycleImpact":"",
 "expectedSymptoms":[],
 "travelPreparation":[],
 "recommendedActivities":[],
 "thingsToAvoid":[],
 "periodManagementTips":[],
 "bestAdvice":""
}


Consider:
- menstrual phase
- energy levels
- hormonal changes
- cramps
- mood changes
- fatigue
- travel comfort

Keep suggestions practical.
`;





        // --------------------------------
        // OpenAI Call
        // --------------------------------


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





        const output =
            response.choices[0]
                .message
                .content;



        const clean =
            output.replace(
                /```json|```/g,
                ""
            );



        const aiResult =
            JSON.parse(clean);





        return res.json({

            success: true,


            data: {


                trip: {
                    startDate,
                    endDate,
                    purpose,
                    activity
                },


                cycleAnalysis: {


                    cycleDay,

                    phase,


                    nextPeriod:
                        nextPeriod.format("YYYY-MM-DD"),


                    ovulation:
                        ovulationDay.format("YYYY-MM-DD")


                },


                aiInsights: aiResult


            }


        });



    }
    catch (error) {

        console.error(
            "Trip planner AI error:",
            error
        );


        return res.status(500).json({

            message:
                "Trip planning failed"

        });


    }

};
