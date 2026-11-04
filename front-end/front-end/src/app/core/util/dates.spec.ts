import {
  addMonths,
  daysBetween,
  formatDate,
  formatMonth,
  isIsoDate,
  isoWeekday,
  startOfWeek,
} from './dates';

describe('dates', () => {
  it('adds months, clamping to the end of shorter months', () => {
    expect(addMonths('2026-10-14', 1)).toBe('2026-11-14');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('computes ISO weekdays and week starts (Monday)', () => {
    expect(isoWeekday('2026-10-14')).toBe(3); // Wednesday
    expect(isoWeekday('2026-10-18')).toBe(7); // Sunday
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
  });

  it('counts days across month boundaries', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-11-02', '2026-10-30')).toBe(-3);
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-10-14')).toBe(true);
    expect(isIsoDate('14.10.2026')).toBe(false);
    expect(isIsoDate(20261014)).toBe(false);
  });

  it('formats Romanian labels', () => {
    expect(formatDate('2026-10-31')).toBe('31-10-2026');
    expect(formatDate('2026-03-05')).toBe('05-03-2026');
    expect(formatMonth('2026-10')).toBe('Octombrie 2026');
  });
});
