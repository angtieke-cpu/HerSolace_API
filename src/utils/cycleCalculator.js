const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

// Every screen (Home, Calendar, AI) and the AI prompt must agree on what day of the cycle
// "today" is, so they all anchor to this one fixed timezone rather than whatever timezone the
// server process itself happens to be running in (which, left unspecified, silently drifted
// "today" by up to a day right around midnight IST and caused Home/Calendar/AI to disagree).
const APP_TIMEZONE = "Asia/Kolkata";

/**
 * Rolls `startDate` forward past every cycle that's *unambiguously* over — i.e. only once a
 * whole ADDITIONAL cycle has also fully elapsed since it — while always leaving the most recent
 * cycle-length span open. That's what lets a currently-overdue cycle keep reporting a real,
 * growing `delayDays` (the "delay" the rest of the app already relies on) instead of being
 * silently treated as "a new cycle must have started" the moment it runs one day past its
 * expected length; only after ~2 full cycle-lengths of silence does it assume a cycle happened
 * and wasn't logged, and roll forward.
 */
function resolveEffectiveCycleStart(startDate, cycleLength, today) {
  const daysSinceStart = today.diff(startDate, "day");
  const missedFullCycles =
    daysSinceStart >= cycleLength
      ? Math.floor(daysSinceStart / cycleLength) - 1
      : 0;
  return {
    effectiveStart: startDate.add(missedFullCycles * cycleLength, "day"),
    missedFullCycles,
  };
}

/**
 * Single source of truth for "today's" cycle day, phase and predicted dates — shared by every
 * endpoint that needs them (getCyclePrediction for Home, getCycleCalendarDetails for Calendar,
 * the /api/ai/* endpoints for the AI screen and its prompt) so they can never independently
 * drift apart.
 */
function calculateCycle({ lastPeriodDate, cycleLength, bleedingDays }) {
  if (!lastPeriodDate || !cycleLength || !bleedingDays) {
    throw new Error("lastPeriodDate, cycleLength and bleedingDays are required");
  }

  const today = dayjs().tz(APP_TIMEZONE).startOf("day");
  // `lastPeriodDate` is a plain calendar date (a 'YYYY-MM-DD' string, or a value that formats
  // to one) with no time-of-day meaning of its own, so it's anchored the same way regardless of
  // the server process's own timezone — never read back out as a UTC instant.
  const startDate = dayjs(lastPeriodDate).startOf("day");

  if (!startDate.isValid()) {
    throw new Error("Invalid date format");
  }

  const { effectiveStart, missedFullCycles } = resolveEffectiveCycleStart(
    startDate,
    cycleLength,
    today
  );

  const currentDay = today.diff(effectiveStart, "day") + 1;
  const isOverdue = currentDay > cycleLength;
  const delayDays = isOverdue ? currentDay - cycleLength : 0;
  // Kept for callers that already display "adjusted cycle length" (e.g. Home) — the current
  // cycle's length once you count the overdue days it's already run past the average.
  const adjustedCycleLength = isOverdue ? currentDay : cycleLength;

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

  // ---------------- OVERDUE ----------------
  // Past the typical cycle length with no new period logged yet — stay in the deepest luteal
  // read (a period could start any day now) instead of falling through to Follicular for a
  // "day" that doesn't exist in a normal-length cycle.
  else if (currentDay > cycleLength) {
    phase = "Luteal Phase";
    stage = "End";
    fertilityStatus = "Low Fertility";
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

    if (totalDays <= 2) {
      // very short → all End
      stage = "End";
    }
    else if (totalDays <= 4) {
      // small range → Start + End split
      if (currentDay === follicularStart) stage = "Start";
      else stage = "End";
    }
    else {
      const startRangeEnd = follicularStart + 1; // first 2 days
      const endRangeStart = follicularEnd - 1;   // last 2 days

      if (currentDay <= startRangeEnd) {
        stage = "Start";
      }
      else if (currentDay >= endRangeStart) {
        stage = "End";
      }
      else {
        stage = "Mid";
      }
    }

    // fertility logic
    if (currentDay >= ovulationDay - 5) {
      fertilityStatus = "High Fertility";
    }
  }

  // Anchored to `effectiveStart` (the current, possibly rolled-forward cycle) rather than the
  // raw last logged period date, so ovulation/fertile-window/next-period predictions stay tied
  // to the cycle that's actually open right now.
  const rawNextPeriod = effectiveStart.add(cycleLength, "day");
  const nextPeriod = isOverdue ? today.add(1, "day") : rawNextPeriod;

  const ovulationDate = effectiveStart.add(ovulationDay - 1, "day");
  const fertileWindowStart = effectiveStart.add(ovulationDay - 5 - 1, "day");
  const fertileWindowEnd = effectiveStart.add(ovulationDay + 1 - 1, "day");

  const dayLabel = `Day ${currentDay} - ${phase} (${stage})`;

  return {
    today: today.format("YYYY-MM-DD"),
    currentDay,
    phase,
    stage,
    dayLabel,
    fertilityStatus,

    delayDays,
    adjustedCycleLength,
    isOverdue,
    missedFullCycles,

    ovulation: {
      cycleDay: ovulationDay,
      date: ovulationDate.format("YYYY-MM-DD"),
    },

    fertileWindow: {
      start: fertileWindowStart.format("YYYY-MM-DD"),
      end: fertileWindowEnd.format("YYYY-MM-DD"),
    },

    nextPeriod: nextPeriod.format("YYYY-MM-DD"),
  };
}

module.exports = { calculateCycle, resolveEffectiveCycleStart, APP_TIMEZONE };
