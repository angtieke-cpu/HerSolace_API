const dayjs = require("dayjs");

function calculateCycle({ lastPeriodDate, cycleLength, bleedingDays }) {
  if (!lastPeriodDate || !cycleLength || !bleedingDays) {
    throw new Error("lastPeriodDate, cycleLength and bleedingDays are required");
  }

  const today = dayjs();
  const startDate = dayjs(lastPeriodDate);

  if (!startDate.isValid()) {
    throw new Error("Invalid date format");
  }

  const diffDays = today.diff(startDate, "day");
  const currentDay = (diffDays % cycleLength) + 1;

  const ovulationDay = cycleLength - 14;

  let phase = "";
  let stage = "";
  let fertilityStatus = "Low Fertility";

  // ---------------- MENSTRUAL ----------------
  if (currentDay <= bleedingDays) {
    phase = "Menstrual Phase";

    if (currentDay === 1) stage = "Start";
    else if (currentDay === bleedingDays) stage = "End";
    else stage = "Mid";
  }

  // ---------------- OVULATION ----------------
  else if (
    currentDay >= ovulationDay - 2 &&
    currentDay <= ovulationDay + 2
  ) {
    phase = "Ovulation Phase";

    if (currentDay === ovulationDay) {
      stage = "Mid";
      fertilityStatus = "Peak Fertility";
    } else if (currentDay < ovulationDay) {
      stage = "Start";
      fertilityStatus = "High Fertility";
    } else {
      stage = "End";
      fertilityStatus = "High Fertility";
    }
  }

  // ---------------- LUTEAL ----------------
  else if (currentDay >= cycleLength - 12) {
    phase = "Luteal Phase";

    const offset = currentDay - (cycleLength - 12);

    if (offset < 4) stage = "Start";
    else if (offset < 8) stage = "Mid";
    else stage = "End";

    fertilityStatus = "Low Fertility";
  }

  // ---------------- FOLLICULAR ----------------
  else {
    phase = "Follicular Phase";

    const follicularStart = bleedingDays + 1;
    const follicularEnd = ovulationDay - 3;

    const totalDays = follicularEnd - follicularStart + 1;

    if (totalDays <= 4) {
      stage = "End";
    } else {
      const lastTwoStart = follicularEnd - 1;

      if (currentDay >= lastTwoStart) {
        stage = "End";
      } else {
        stage = "Mid";
      }
    }

    // fertility logic
    if (currentDay >= ovulationDay - 5) {
      fertilityStatus = "High Fertility";
    }
  }

  const nextPeriod = startDate.add(cycleLength, "day");

  const fertileWindowStart = startDate.add(ovulationDay - 5 - 1, "day");
  const fertileWindowEnd = startDate.add(ovulationDay + 1 - 1, "day");

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