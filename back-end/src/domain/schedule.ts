import type { TrainingState } from '../contract/models.js';
import { WEEKDAYS, minutesNow, minutesOfDay, toIsoDate } from '../lib/dates.js';

/** Members can check in this many minutes before a training starts. */
export const CHECKIN_WINDOW_BEFORE_MIN = 30;

export interface SlotTiming {
  weekday: number;
  time: string;
  durationMin: number;
}

export function trainingState(date: string, slot: SlotTiming, now: Date): TrainingState {
  const today = toIsoDate(now);
  if (date !== today) return date < today ? 'done' : 'upcoming';
  const nowMin = minutesNow(now);
  const start = minutesOfDay(slot.time);
  if (nowMin < start) return 'upcoming';
  return nowMin < start + slot.durationMin ? 'live' : 'done';
}

/**
 * Picks the training a check-in made `now` belongs to among today's slots: one that is
 * running or starts within the check-in window, preferring the member's own courses.
 */
export function currentSlot<T extends SlotTiming & { courseId: string }>(
  todaysSlots: T[],
  now: Date,
  courseIds: string[] = [],
): T | null {
  const nowMin = minutesNow(now);
  const candidates = todaysSlots
    .filter((s) => {
      const start = minutesOfDay(s.time);
      return nowMin >= start - CHECKIN_WINDOW_BEFORE_MIN && nowMin < start + s.durationMin;
    })
    .sort((a, b) => a.time.localeCompare(b.time));
  return candidates.find((s) => courseIds.includes(s.courseId)) ?? candidates.at(-1) ?? null;
}

/** "Luni – Vineri · 20:00", "Marți, Joi · 17:00 / Sâmbătă · 14:00" */
export function scheduleSummary(slots: Pick<SlotTiming, 'weekday' | 'time'>[]): string {
  const byTime = new Map<string, number[]>();
  for (const s of slots) byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.weekday]);
  return [...byTime.entries()]
    .sort(([, a], [, b]) => Math.min(...a) - Math.min(...b))
    .map(([time, days]) => `${formatWeekdays(days)} · ${time}`)
    .join(' / ');
}

/** [1,2,3,4,5] → "Luni – Vineri"; [2,4] → "Marți, Joi" */
export function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length >= 3 && consecutive) {
    return `${WEEKDAYS[sorted[0] - 1]} – ${WEEKDAYS[sorted.at(-1)! - 1]}`;
  }
  return sorted.map((d) => WEEKDAYS[d - 1]).join(', ');
}
