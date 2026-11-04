import type { MemberStats } from '../contract/models.js';
import { addDays, isoWeekday, startOfWeek, toMonth, addMonthsToMonth } from '../lib/dates.js';

/** One check-in as the stats need it. */
export interface StatsCheckIn {
  /** Local `YYYY-MM-DD`. */
  date: string;
  trainingLabel: string | null;
  /** Length of the training; `null` (open gym, deleted slot) counts as 60 minutes. */
  durationMin: number | null;
}

const WEEKS_SHOWN = 8;
const DEFAULT_MINUTES = 60;

/** Attendance figures for the member portal. Pure: same input, same output. */
export function memberStats(checkIns: StatsCheckIn[], today: string): MemberStats {
  const month = toMonth(today);
  const previousMonth = addMonthsToMonth(month, -1);
  const byLabel = new Map<string, number>();
  const byWeekday = new Map<number, number>();
  const byWeek = new Map<string, number>();
  let minutes = 0;
  let thisMonth = 0;
  let lastMonth = 0;
  for (const c of checkIns) {
    minutes += c.durationMin ?? DEFAULT_MINUTES;
    if (c.date.startsWith(month)) thisMonth++;
    else if (c.date.startsWith(previousMonth)) lastMonth++;
    if (c.trainingLabel) byLabel.set(c.trainingLabel, (byLabel.get(c.trainingLabel) ?? 0) + 1);
    const weekday = isoWeekday(c.date);
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + 1);
    const week = startOfWeek(c.date);
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }

  const top = <K>(counts: Map<K, number>): [K, number] | null =>
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const label = top(byLabel);
  const weekday = top(byWeekday);

  // Streaks of consecutive weeks with at least one check-in.
  const thisWeek = startOfWeek(today);
  let streakEnd = byWeek.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let current = 0;
  while (byWeek.has(streakEnd)) {
    current++;
    streakEnd = addDays(streakEnd, -7);
  }
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const week of [...byWeek.keys()].sort()) {
    run = previous && addDays(previous, 7) === week ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = week;
  }

  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const weekStart = addDays(thisWeek, -7 * (WEEKS_SHOWN - 1 - i));
    return { weekStart, count: byWeek.get(weekStart) ?? 0 };
  });

  return {
    total: checkIns.length,
    thisMonth,
    lastMonth,
    trainingHours: Math.round(minutes / 60),
    favoriteTraining: label ? { label: label[0], count: label[1] } : null,
    favoriteWeekday: weekday ? weekday[0] : null,
    currentStreakWeeks: current,
    longestStreakWeeks: longest,
    weeks,
  };
}
