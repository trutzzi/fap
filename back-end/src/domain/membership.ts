import type { MemberStatus, MemberSummary, SubscriptionUsage } from '../contract/models.js';
import { addDays, addMonths, daysBetween } from '../lib/dates.js';

/** A subscription is "expiring" when fewer than this many days remain. */
export const EXPIRING_WITHIN_DAYS = 7;

/** Last day (inclusive) of a subscription period starting on `startDate`. */
export function periodEnd(startDate: string): string {
  return addDays(addMonths(startDate, 1), -1);
}

export interface UsageInput {
  planId: SubscriptionUsage['planId'];
  planName: string;
  sessionLimit: number | null;
  price: number | null;
  startDate: string;
  endDate: string;
  used: number;
}

export function usage(input: UsageInput): SubscriptionUsage {
  return {
    ...input,
    remaining: input.sessionLimit === null ? null : Math.max(input.sessionLimit - input.used, 0),
  };
}

export function memberStatus(sub: SubscriptionUsage | null, today: string): MemberStatus {
  if (!sub) return 'none';
  if (sub.endDate < today) return 'expired';
  if (sub.remaining === 0) return 'limit';
  if (daysBetween(today, sub.endDate) < EXPIRING_WITHIN_DAYS || sub.remaining === 1) {
    return 'expiring';
  }
  return 'active';
}

/** `active` in the API's sense: a valid subscription, even if expiring or at its limit. */
export function isActive(status: MemberStatus): boolean {
  return status === 'active' || status === 'expiring' || status === 'limit';
}

export function initials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

export function normalizeRfid(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export function matchesSearch(member: MemberSummary, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const rfid = normalizeRfid(q);
  return (
    member.fullName.toLowerCase().includes(q) ||
    member.email.toLowerCase().includes(q) ||
    (digits.length >= 3 && member.phone.replace(/\D/g, '').includes(digits)) ||
    (rfid.length >= 4 && (member.rfid ?? '').includes(rfid))
  );
}
