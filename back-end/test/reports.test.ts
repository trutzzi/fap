import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../src/db.js';
import { db, resetData, setNow, signedIn } from './helpers.js';

let staff: Awaited<ReturnType<typeof signedIn>>;

async function member(firstName: string, phone = '+40 722 000 111') {
  const res = await staff
    .post('/api/members')
    .send({
      firstName,
      lastName: 'Pop',
      phone,
      courseIds: ['kb'],
      subscription: { planId: 'unlimited', startDate: '2026-10-01' },
    })
    .expect(201);
  return res.body as { id: string };
}

beforeEach(async () => {
  await resetData(); // Kickboxing on Wednesdays at 20:00; "today" is Wed 14 Oct 2026
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('reports', () => {
  it('summarizes attendance per course, hour and member, and lists inactive members', async () => {
    const ana = await member('Ana');
    await member('Ion'); // never came
    // Ana trained on Wed 7 and Wed 14 at the Kickboxing slot, plus once without a training.
    await db.checkIn.createMany({
      data: [
        {
          memberId: ana.id,
          slotId: 'kb-wed',
          date: toDbDate('2026-10-07'),
          timestamp: new Date(2026, 9, 7, 19, 55),
          method: 'rfid',
        },
        {
          memberId: ana.id,
          slotId: 'kb-wed',
          date: toDbDate('2026-10-14'),
          timestamp: new Date(2026, 9, 14, 19, 50),
          method: 'rfid',
        },
        {
          memberId: ana.id,
          slotId: null,
          date: toDbDate('2026-10-10'),
          timestamp: new Date(2026, 9, 10, 11, 0),
          method: 'manual',
        },
      ],
    });

    const res = await staff.get('/api/reports?month=2026-10').expect(200);
    expect(res.body.totals).toEqual({ checkins: 3, members: 1, refused: 0 });
    // Wednesdays up to the 14th: 7 and 14 → 2 trainings held, 2 check-ins.
    expect(res.body.byCourse).toEqual([
      expect.objectContaining({
        courseId: 'kb',
        checkins: 2,
        members: 1,
        trainings: 2,
        average: 1,
      }),
      expect.objectContaining({ courseId: null, name: 'Acces liber / altele', checkins: 1 }),
    ]);
    expect(res.body.heatmap).toEqual(
      expect.arrayContaining([
        { weekday: 3, hour: 19, count: 2 },
        { weekday: 6, hour: 11, count: 1 },
      ]),
    );
    expect(res.body.topMembers).toEqual([{ memberId: ana.id, fullName: 'Ana Pop', checkins: 3 }]);
    expect(res.body.inactive.map((m: { fullName: string }) => m.fullName)).toEqual(['Ion Pop']);

    setNow(new Date(2026, 9, 28, 12, 0)); // 14 days after Ana's last visit (session still valid)
    const later = await staff.get('/api/reports?month=2026-10').expect(200);
    expect(later.body.inactive).toEqual(
      expect.arrayContaining([expect.objectContaining({ fullName: 'Ana Pop', daysSince: 14 })]),
    );
  });

  it('exports Excel-friendly CSV with diacritics and no formula injection', async () => {
    await member('=HYPERLINK("x")');
    const res = await staff.get('/api/reports/members.csv').buffer(true).expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="membri-2026-10-14.csv"/,
    );
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Nume;Telefon;Email;Cursuri;Abonament');
    expect(text).toContain(`"'=HYPERLINK(""x"") Pop"`);
    expect(text).toContain('Kickboxing;Nelimitat;2026-10-31');
  });

  it('is not available to coaches', async () => {
    const coach = await signedIn('coach');
    await coach.get('/api/reports').expect(403);
    await coach.get('/api/reports/members.csv').expect(403);
  });
});
