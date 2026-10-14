import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../src/db.js';
import { db, resetData, setNow, signedIn } from './helpers.js';

/** Signed in as admin; tests about permissions live in auth.test.ts. */
let api: Awaited<ReturnType<typeof signedIn>>;

async function createMember(overrides: Record<string, unknown> = {}) {
  const res = await api.post('/api/members').send({
    firstName: 'Andrei',
    lastName: 'Popescu',
    phone: '0722 513 418',
    courseIds: ['kb'],
    rfid: '04A3·91F2',
    subscription: { planId: 'sessions12', startDate: '2026-10-01' },
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

/** Adds `count` past check-ins (one per day from 1 Oct) without going through the API. */
async function addPastCheckIns(memberId: string, count: number) {
  await db.checkIn.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      memberId,
      date: toDbDate(`2026-10-${String(i + 1).padStart(2, '0')}`),
      timestamp: new Date(2026, 9, i + 1, 19, 55),
      method: 'rfid' as const,
    })),
  });
}

beforeEach(async () => {
  await resetData();
  api = await signedIn('admin');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('members API', () => {
  it('creates a member with a normalized card and a subscription period', async () => {
    const { id } = await createMember();
    const res = await api.get(`/api/members/${id}`).expect(200);
    expect(res.body).toMatchObject({
      fullName: 'Andrei Popescu',
      initials: 'AP',
      rfid: '04A391F2',
      joinedAt: '2026-10-14',
      courses: [{ id: 'kb', name: 'Kickboxing' }],
      subscription: {
        planId: 'sessions12',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        used: 0,
        remaining: 12,
      },
      status: 'active',
      history: [],
    });
  });

  it('validates input with Romanian messages', async () => {
    const res = await api
      .post('/api/members')
      .send({ firstName: '', lastName: 'X', phone: '0722 000 000' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Prenumele este obligatoriu.' });

    const badCourse = await api
      .post('/api/members')
      .send({ firstName: 'A', lastName: 'B', phone: '0722 000 000', courseIds: ['nope'] });
    expect(badCourse.body.message).toBe('Unul dintre cursuri nu există.');
  });

  it('rejects a card already assigned to another member', async () => {
    await createMember();
    const res = await api
      .post('/api/members')
      .send({ firstName: 'Maria', lastName: 'Ionescu', phone: '0745 220 102', rfid: '04a391f2' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Cardul este deja alocat lui Andrei Popescu.');
  });

  it('filters, searches and pages the member list', async () => {
    await createMember();
    await createMember({ firstName: 'Vlad', lastName: 'Petrescu', rfid: null, subscription: null });
    const all = await api.get('/api/members').expect(200);
    expect(all.body).toMatchObject({ total: 2, activeCount: 1, inactiveCount: 1 });
    const expired = await api.get('/api/members?filter=expired').expect(200);
    expect(expired.body.items.map((m: { fullName: string }) => m.fullName)).toEqual([
      'Vlad Petrescu',
    ]);
    const byCard = await api.get('/api/members?q=04a3').expect(200);
    expect(byCard.body.total).toBe(1);
    const page = await api.get('/api/members?pageSize=1&page=9').expect(200);
    expect(page.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
  });

  it('renews a subscription and deletes a member with their history', async () => {
    const { id } = await createMember();
    await addPastCheckIns(id, 3);
    const renewed = await api
      .put(`/api/members/${id}/subscription`)
      .send({ planId: 'unlimited', startDate: '2026-10-14' })
      .expect(200);
    expect(renewed.body.subscription).toMatchObject({
      planId: 'unlimited',
      endDate: '2026-11-13',
      used: 0,
    });

    await api.delete(`/api/members/${id}`).expect(204);
    await api.get(`/api/members/${id}`).expect(404);
    expect(await db.checkIn.count()).toBe(0);
  });
});

describe('check-in', () => {
  it('admits a member, ignores a second tap and blocks at the session limit', async () => {
    const { id } = await createMember();
    await addPastCheckIns(id, 11);

    const first = await api.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    expect(first.body).toMatchObject({
      outcome: 'allowed',
      trainingLabel: 'Kickboxing',
      member: { subscription: { used: 12, remaining: 0 }, status: 'limit' },
    });

    const again = await api.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    expect(again.body.outcome).toBe('already-checked-in');

    setNow(new Date(2026, 9, 16, 19, 50)); // Friday, no Kickboxing slot → no duplicate match
    const blocked = await api.post('/api/checkins').send({ memberId: id }).expect(200);
    expect(blocked.body.outcome).toBe('limit');
    expect(await db.checkIn.count({ where: { memberId: id } })).toBe(12);
  });

  it('counts concurrent taps only once', async () => {
    await createMember();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.post('/api/checkins').send({ rfid: '04A391F2' })),
    );
    const outcomes = results.map((r) => r.body.outcome).sort();
    expect(outcomes.filter((o) => o === 'allowed')).toHaveLength(1);
    expect(await db.checkIn.count()).toBe(1);
  });

  it('reports unknown cards, expired and missing subscriptions', async () => {
    const unknown = await api.post('/api/checkins').send({ rfid: 'DEADBEEF' }).expect(200);
    expect(unknown.body).toEqual({ outcome: 'unknown-card', member: null, trainingLabel: null });

    const expired = await createMember({
      rfid: '0001',
      subscription: { planId: 'sessions12', startDate: '2026-09-01' },
    });
    const none = await createMember({ firstName: 'Ion', rfid: '0002', subscription: null });
    const r1 = await api.post('/api/checkins').send({ memberId: expired.id });
    const r2 = await api.post('/api/checkins').send({ memberId: none.id });
    expect([r1.body.outcome, r2.body.outcome]).toEqual(['expired', 'no-subscription']);
  });

  it('shows the current training on the kiosk', async () => {
    const res = await api.get('/api/kiosk/status').expect(200);
    expect(res.body.current).toMatchObject({
      label: 'Kickboxing',
      time: '20:00',
      coach: 'Albu Marius',
    });
  });
});

describe('catalog and insights', () => {
  it('summarizes courses and keeps check-in labels when a course is deleted', async () => {
    const { id } = await createMember();
    await api.post('/api/checkins').send({ memberId: id }).expect(200);
    const courses = await api.get('/api/courses').expect(200);
    expect(courses.body).toEqual([
      expect.objectContaining({ scheduleSummary: 'Miercuri · 20:00', memberCount: 1 }),
    ]);

    await api.delete('/api/courses/kb').expect(204);
    const checkIn = await db.checkIn.findFirstOrThrow();
    expect(checkIn).toMatchObject({ slotId: null, trainingLabel: 'Kickboxing' });
  });

  it('validates training slots', async () => {
    const res = await api
      .post('/api/slots')
      .send({ courseId: 'kb', weekday: 8, time: '20:00', durationMin: 60, capacity: 20 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Ziua trebuie să fie un număr între 1 și 7.');
  });

  it('builds the dashboard and weekly schedule', async () => {
    const { id } = await createMember();
    await addPastCheckIns(id, 12);
    const dashboard = await api.get('/api/dashboard').expect(200);
    expect(dashboard.body).toMatchObject({
      activeMembers: 1,
      checkinsThisMonth: 12,
      alerts: [{ kind: 'limit', detail: 'A atins limita de 12 ședințe · expiră 31 oct' }],
      today: [{ name: 'Kickboxing', state: 'upcoming', startsInMin: 15 }],
    });
    expect(dashboard.body.week).toHaveLength(7);

    const schedule = await api.get('/api/schedule?week=2026-10-15').expect(200);
    expect(schedule.body.weekStart).toBe('2026-10-12');
    expect(schedule.body.days[2]).toMatchObject({
      isToday: true,
      entries: [{ name: 'Kickboxing' }],
    });
  });

  it('returns JSON errors for unknown routes and bad JSON', async () => {
    expect((await api.get('/api/nope')).body).toEqual({ message: 'Resursa nu există.' });
    const bad = await api
      .post('/api/courses')
      .set('content-type', 'application/json')
      .send('{oops');
    expect(bad.status).toBe(400);
  });
});
