import { describe, expect, it } from 'vitest';
import type { SubscriptionUsage } from '../src/contract/models.js';
import { memberStatus, normalizeRfid, periodEnd, usage } from '../src/domain/membership.js';
import { currentSlot, scheduleSummary, trainingState } from '../src/domain/schedule.js';

const sub = (overrides: Partial<Parameters<typeof usage>[0]>): SubscriptionUsage =>
  usage({
    planId: 'sessions12',
    planName: '12 ședințe / lună',
    sessionLimit: 12,
    price: null,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    used: 0,
    ...overrides,
  });

describe('membership', () => {
  it('computes inclusive one-month periods', () => {
    expect(periodEnd('2026-10-01')).toBe('2026-10-31');
    expect(periodEnd('2026-01-31')).toBe('2026-02-27');
    expect(periodEnd('2026-12-15')).toBe('2027-01-14');
  });

  it('derives status from usage and dates', () => {
    const today = '2026-10-14';
    expect(memberStatus(null, today)).toBe('none');
    expect(memberStatus(sub({ used: 8 }), today)).toBe('active');
    expect(memberStatus(sub({ used: 11 }), today)).toBe('expiring');
    expect(memberStatus(sub({ used: 12 }), today)).toBe('limit');
    expect(memberStatus(sub({ endDate: '2026-10-16' }), today)).toBe('expiring');
    expect(memberStatus(sub({ endDate: '2026-10-13' }), today)).toBe('expired');
    expect(memberStatus(sub({ sessionLimit: null, used: 40 }), today)).toBe('active');
  });

  it('normalizes card codes', () => {
    expect(normalizeRfid('04a3·91f2')).toBe('04A391F2');
    expect(normalizeRfid(' 04:A3-91 F2 ')).toBe('04A391F2');
  });
});

describe('schedule', () => {
  const slot = (time: string, courseId = 'kb') => ({ weekday: 3, time, durationMin: 60, courseId });
  const at = (h: number, m: number) => new Date(2026, 9, 14, h, m);

  it('tracks a training through the day', () => {
    expect(trainingState('2026-10-14', slot('20:00'), at(19, 59))).toBe('upcoming');
    expect(trainingState('2026-10-14', slot('20:00'), at(20, 30))).toBe('live');
    expect(trainingState('2026-10-14', slot('20:00'), at(21, 0))).toBe('done');
    expect(trainingState('2026-10-13', slot('20:00'), at(9, 0))).toBe('done');
  });

  it('attaches check-ins to the current training, preferring the member’s course', () => {
    const slots = [slot('20:00', 'kb'), slot('20:15', 'bjj')];
    expect(currentSlot(slots, at(19, 20))).toBeNull();
    expect(currentSlot(slots, at(19, 50), ['kb'])?.courseId).toBe('kb');
    expect(currentSlot(slots, at(19, 50), ['bjj'])?.courseId).toBe('bjj');
  });

  it('summarizes weekly slots', () => {
    const days = (weekdays: number[], time: string) =>
      weekdays.map((weekday) => ({ weekday, time }));
    expect(scheduleSummary(days([1, 2, 3, 4, 5], '20:00'))).toBe('Luni – Vineri · 20:00');
    expect(scheduleSummary([...days([6], '14:00'), ...days([2, 4], '17:00')])).toBe(
      'Marți, Joi · 17:00 / Sâmbătă · 14:00',
    );
  });
});
