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

  if (currentDay <= 5) {
    phase = "Menstrual Phase";
    fertilityStatus = "Low Fertility";
  } else if (currentDay < ovulationDay) {
    phase = "Follicular Phase";
    fertilityStatus =
      currentDay >= fertileStart ? "High Fertility" : "Low Fertility";
  } else if (currentDay === ovulationDay) {
    phase = "Ovulation";
    fertilityStatus = "Peak Fertility";
  } else {
    phase = "Luteal Phase";
    fertilityStatus = "Low Fertility";
  }

  const nextPeriod = startDate.add(cycleLength, "day");

  const fertileWindowStart = startDate.add(fertileStart - 1, "day");
  const fertileWindowEnd = startDate.add(fertileEnd - 1, "day");

  return {
    today: today.format("YYYY-MM-DD"),
    currentDay,
    phase,
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