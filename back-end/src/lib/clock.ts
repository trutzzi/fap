import { toIsoDate } from './dates.js';

/** Source of "now", injectable so tests can pin the date. Times are in the process TZ. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

export function today(clock: Clock): string {
  return toIsoDate(clock());
}
