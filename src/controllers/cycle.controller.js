const db = require("../db");
const { calculateCycle } = require("../utils/cycleCalculator");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);


exports.getCyclePrediction = async (req, res) => {
};
exports.getPreviousCycleDetails = async (req, res) => {
};
exports.getCycleHormoneData = async (req, res) => {
};

exports.createDailyLog = async (req, res) => {
};

exports.getTodayLog = async (req, res) => {
};

exports.logLatestPeriod = async (req, res) => {
};

exports.getUserPeriodLogs = async (req, res) => {
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
        message:"At least one field required"
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



    if(latestResult.rows.length===0){

      return res.status(404).json({
        message:"No cycle found"
      });

    }



    const latestId =
      latestResult.rows[0].id;




    // Dynamic update

    const updates=[];
    const values=[];


    let index=1;



    if(periodDate){

      updates.push(
        `period_date=$${index++}`
      );

      values.push(periodDate);

    }



    if(bleedingDays){

      if(
        bleedingDays < 1 ||
        bleedingDays > 15
      ){

        return res.status(400).json({
          message:"Invalid bleeding days"
        });

      }


      updates.push(
        `bleeding_days=$${index++}`
      );

      values.push(
        bleedingDays
      );

    }




    if(cycleLength){

      if(
        cycleLength < 15 ||
        cycleLength > 60
      ){

        return res.status(400).json({
          message:"Invalid cycle length"
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

      success:true,

      message:"Cycle details updated successfully",

      data:{

        id:updated.id,

        period_date:
          updated.period_date,

        bleeding_days:
          updated.bleeding_days,

        cycle_length:
          updated.cycle_length

      }

    });



  }
  catch(error){

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

        success:true,

        data:{
          history:[],
          current_cycle:null,
          predictions:null,

          statistics:{
            average_cycle_length:28,
            regularity:"—",
            regularity_score:0,
            total_cycles_tracked:0
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


    if(history.length === 1){

      cycleLength =
        history[0].cycle_length || 28;

    }


    if(history.length > 1){

      let total = 0;


      for(let i=1;i<history.length;i++){

        total += dayjs(
          history[i].period_date
        )
        .diff(
          dayjs(history[i-1].period_date),
          "day"
        );

      }


      cycleLength =
        Math.round(
          total / (history.length-1)
        );

    }




    const lastRecord =
      history[history.length-1];


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



    while(
      effectiveCycleStart
      .add(cycleLength,"day")
      .isBefore(today)
    ){

      effectiveCycleStart =
        effectiveCycleStart
        .add(cycleLength,"day");

    }





    // ----------------------------
    // Cycle Predictions
    // ----------------------------


    const ovulation =
      effectiveCycleStart
      .add(
        cycleLength-14,
        "day"
      );



    const fertileStart =
      ovulation
      .subtract(5,"day");



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
      today.add(1,"day")
      :
      rawNextPeriod;





    const pmsStart =
      nextPeriod.subtract(5,"day");


    const pmsEnd =
      nextPeriod.subtract(1,"day");





    const daysUntilNextPeriod =
      nextPeriod.diff(
        today,
        "day"
      );






    // ----------------------------
    // Fertility Level
    // SAME AS FRONTEND
    // ----------------------------


    let fertilityLevel="Low";


    if(
      today.format("YYYY-MM-DD")
      ===
      ovulation.format("YYYY-MM-DD")
    ){

      fertilityLevel="Peak";

    }
    else if(

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

    ){

      fertilityLevel="High";

    }








    // ----------------------------
    // Regularity Calculation
    // SAME AS FRONTEND
    // ----------------------------


    let regularity="—";
    let regularityScore=0;



    if(history.length >= 2){

      let diffs=[];


      for(let i=1;i<history.length;i++){

        diffs.push(

          dayjs(
            history[i].period_date
          )
          .diff(
            dayjs(history[i-1].period_date),
            "day"
          )

        );

      }



      const avg =
        diffs.reduce(
          (a,b)=>a+b,
          0
        )
        /
        diffs.length;



      const variance =
        diffs.reduce(
          (sum,value)=>
          sum +
          Math.abs(value-avg),
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
              100-(variance*8)
            )
          )
        );


    }





    // ----------------------------
    // Future Cycles
    // SAME AS FRONTEND 12 cycles
    // ----------------------------


    const futureCycles=[];



    for(let i=0;i<12;i++){


      const period =
        nextPeriod
        .add(
          i*cycleLength,
          "day"
        );



      const futureOvulation =
        period
        .add(
          cycleLength-14,
          "day"
        );



      futureCycles.push({

        period_date:
          period.format("YYYY-MM-DD"),


        ovulation_date:
          futureOvulation.format("YYYY-MM-DD"),


        fertile_start:
          futureOvulation
          .subtract(5,"day")
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

      success:true,


      data:{


        history,



        current_cycle:{


          last_period_date:
            lastPeriod.format("YYYY-MM-DD"),


          bleeding_days:
            bleedingDays,


          cycle_length:
            cycleLength,



          ovulation_date:
            ovulation.format("YYYY-MM-DD"),



          fertile_window:{

            start:
              fertileStart.format("YYYY-MM-DD"),


            end:
              fertileEnd.format("YYYY-MM-DD")

          },



          next_period_date:
            nextPeriod.format("YYYY-MM-DD"),



          pms_window:{


            start:
              pmsStart.format("YYYY-MM-DD"),


            end:
              pmsEnd.format("YYYY-MM-DD")

          }


        },



        predictions:{


          next_period_date:
            nextPeriod.format("YYYY-MM-DD"),



          days_until_next_period:
            daysUntilNextPeriod,



          fertility_level:
            fertilityLevel,



          future_cycles:
            futureCycles

        },




        statistics:{


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
  catch(error){

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
