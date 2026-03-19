const dayjs = require("dayjs");

function calculateCycle({ lastPeriodDate, cycleLength }) {
  if (!lastPeriodDate || !cycleLength) {
    throw new Error("lastPeriodDate and cycleLength required");
  }

  const today = dayjs();
  const startDate = dayjs(lastPeriodDate);

  if (!startDate.isValid()) {
    throw new Error("Invalid date format");
  }

  const diffDays = today.diff(startDate, "day");
  const currentDay = (diffDays % cycleLength) + 1;

  const ovulationDay = cycleLength - 14;
  const fertileStart = ovulationDay - 5;
  const fertileEnd = ovulationDay + 1;

  let phase = "";
  let fertilityStatus = "";
  let stage = "";

  // 🔥 PHASE + STAGE LOGIC
  if (currentDay <= 5) {
    phase = "Menstrual Phase";

    if (currentDay === 1) stage = "Start";
    else if (currentDay <= 4) stage = "Mid";
    else stage = "End";

    fertilityStatus = "Low Fertility";
  }

  else if (currentDay < ovulationDay) {
    phase = "Follicular Phase";

    if (currentDay === 6) stage = "Start";
    else if (currentDay <= 11) stage = "Mid";
    else stage = "End";

    fertilityStatus =
      currentDay >= fertileStart ? "High Fertility" : "Low Fertility";
  }

  else if (currentDay === ovulationDay) {
    phase = "Ovulation Phase";
    stage = "Start";
    fertilityStatus = "Peak Fertility";
  }

  else if (currentDay === ovulationDay + 1) {
    phase = "Ovulation Phase";
    stage = "Mid";
    fertilityStatus = "High Fertility";
  }

  else if (currentDay === ovulationDay + 2) {
    phase = "Ovulation Phase";
    stage = "End";
    fertilityStatus = "High Fertility";
  }

  else {
    phase = "Luteal Phase";

    if (currentDay <= 20) stage = "Start";
    else if (currentDay <= 25) stage = "Mid";
    else stage = "End";

    fertilityStatus = "Low Fertility";
  }

  const nextPeriod = startDate.add(cycleLength, "day");

  const fertileWindowStart = startDate.add(fertileStart - 1, "day");
  const fertileWindowEnd = startDate.add(fertileEnd - 1, "day");

  // 🔥 Nice readable label (useful for UI)
  const dayLabel = `Day ${currentDay} - ${phase} (${stage})`;

  return {
    today: today.format("YYYY-MM-DD"),
    currentDay,
    phase,
    stage,
    dayLabel,
    fertilityStatus,

    ovulation: {
      cycleDay: ovulationDay,
      date: startDate.add(ovulationDay - 1, "day").format("YYYY-MM-DD"),
    },

    fertileWindow: {
      start: fertileWindowStart.format("YYYY-MM-DD"),
      end: fertileWindowEnd.format("YYYY-MM-DD"),
    },

    nextPeriod: nextPeriod.format("YYYY-MM-DD"),
  };
}

module.exports = { calculateCycle };