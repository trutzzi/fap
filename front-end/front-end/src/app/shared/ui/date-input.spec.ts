import { maskDate, parseDate } from './date-input';

describe('date input', () => {
  it('adds the dashes while typing', () => {
    expect(maskDate('3')).toBe('3');
    expect(maskDate('311')).toBe('31-1');
    expect(maskDate('31122026')).toBe('31-12-2026');
    expect(maskDate('31/12/2026 9')).toBe('31-12-2026');
  });

  it('turns a complete, real date into YYYY-MM-DD', () => {
    expect(parseDate('03-11-2026')).toBe('2026-11-03');
    expect(parseDate('31-02-2026')).toBe('');
    expect(parseDate('03-11-20')).toBe('');
  });
});
