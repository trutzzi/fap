import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../src/db.js';
import { MEMBER_SESSION_COOKIE } from '../src/modules/account/member-sessions.js';
import { sendInactivityNudges } from '../src/modules/reminders/expiry-reminders.js';
import { app, db, resetData, setNow, signedIn, smsOutbox, testPush, testSms } from './helpers.js';

let staff: Awaited<ReturnType<typeof signedIn>>;

async function createMember(phone = '0722000001', startDate = '2026-10-01', rfid = '04A391F2') {
  const res = await staff
    .post('/api/members')
    .send({
      firstName: 'Ana',
      lastName: 'Pop',
      phone,
      courseIds: ['kb'],
      rfid,
      subscription: { planId: 'sessions12', startDate },
    })
    .expect(201);
  return res.body as { id: string; access: { temporaryPin: string } };
}

async function portal(member: { access: { temporaryPin: string } }, phone = '0722000001') {
  const res = await request(app)
    .post('/api/account/login')
    .send({ phone, pin: member.access.temporaryPin })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${MEMBER_SESSION_COOKIE}=`))!;
  return request.agent(app).set('Cookie', cookie.split(';')[0]);
}

const club = (data: Record<string, unknown>) =>
  db.club.create({
    data: {
      id: 1,
      name: 'Fight Academy',
      address: '',
      phone: '',
      email: '',
      website: '',
      timezone: 'Europe/Bucharest',
      ...data,
    },
  });

/** `count` past check-ins on distinct days before `before`. */
async function pastCheckIns(memberId: string, count: number, before = '2026-10-14') {
  const day = new Date(`${before}T12:00:00`);
  await db.checkIn.createMany({
    data: Array.from({ length: count }, (_, i) => {
      const d = new Date(day.getTime() - (i + 1) * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      return { memberId, date: toDbDate(iso), timestamp: d, method: 'rfid' as const };
    }),
  });
}

beforeEach(async () => {
  await resetData();
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('freezing a subscription', () => {
  it('moves the end date later, refuses overlaps, and an admin can undo it', async () => {
    const { id } = await createMember();
    const res = await staff
      .post(`/api/members/${id}/freezes`)
      .send({ from: '2026-10-14', days: 10, reason: 'Accidentare' })
      .expect(201);
    expect(res.body.subscription.endDate).toBe('2026-11-10');
    const detail = (await staff.get(`/api/members/${id}`).expect(200)).body;
    expect(detail.periods[0].endDate).toBe('2026-11-10');
    expect(detail.freezes).toMatchObject([
      {
        from: '2026-10-14',
        to: '2026-10-23',
        days: 10,
        reason: 'Accidentare',
        createdBy: 'Recepție Test',
      },
    ]);

    const overlap = await staff
      .post(`/api/members/${id}/freezes`)
      .send({ from: '2026-10-20', days: 3 })
      .expect(409);
    expect(overlap.body.message).toBe('Perioada se suprapune cu o suspendare existentă.');
    const outside = await staff
      .post(`/api/members/${id}/freezes`)
      .send({ from: '2026-12-20', days: 3 })
      .expect(400);
    expect(outside.body.message).toBe(
      'Suspendarea trebuie să înceapă în perioada abonamentului curent.',
    );

    await staff.delete(`/api/members/${id}/freezes/${detail.freezes[0].id}`).expect(403);
    const admin = await signedIn('admin');
    const undone = await admin
      .delete(`/api/members/${id}/freezes/${detail.freezes[0].id}`)
      .expect(200);
    expect(undone.body.subscription.endDate).toBe('2026-10-31');
  });
});

describe('badges and the Google review', () => {
  it('celebrates the 10th check-in and asks for a review once', async () => {
    await club({ googleReviewUrl: 'https://g.page/r/abc/review', reviewAfterCheckIns: 10 });
    const member = await createMember();
    await pastCheckIns(member.id, 9);
    const phone = await portal(member);
    expect((await phone.get('/api/account').expect(200)).body.reviewPrompt).toBeNull();

    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    const titles = (await phone.get('/api/account/notifications').expect(200)).body.map(
      (n: { title: string }) => n.title,
    );
    expect(titles).toEqual(expect.arrayContaining(['Insignă nouă!', 'Îți place la noi?']));
    expect((await phone.get('/api/account').expect(200)).body.reviewPrompt).toEqual({
      url: 'https://g.page/r/abc/review',
    });
    await phone.post('/api/account/review/done').send({}).expect(204);
    expect((await phone.get('/api/account').expect(200)).body.reviewPrompt).toBeNull();
  });

  it('validates the review link in the club settings', async () => {
    const admin = await signedIn('admin');
    const bad = await admin
      .put('/api/club')
      .send({ name: 'X', timezone: 'Europe/Bucharest', googleReviewUrl: 'g.page/x' })
      .expect(400);
    expect(bad.body.message).toBe('Linkul de recenzie trebuie să înceapă cu https://.');
  });
});

describe('"Ne e dor de tine"', () => {
  const run = (now: Date) =>
    sendInactivityNudges({
      db,
      sms: testSms,
      push: testPush,
      clock: () => now,
      publicUrl: 'https://club.test',
    });

  it('nudges a member away for 14 days once per absence, by SMS too when on', async () => {
    await club({ inactivityNudge: true, inactivityNudgeSms: true });
    const ana = await createMember('0722000001', '2026-10-01', '04A391F2');
    const ion = await createMember('0722000002', '2026-10-20', '04B722C1'); // ends 19 Nov
    await db.checkIn.create({
      data: {
        memberId: ana.id,
        date: toDbDate('2026-10-15'),
        timestamp: new Date(2026, 9, 15, 19),
        method: 'rfid',
      },
    });
    await db.checkIn.create({
      data: {
        memberId: ion.id,
        date: toDbDate('2026-10-25'),
        timestamp: new Date(2026, 9, 25, 19),
        method: 'rfid',
      },
    });

    expect(await run(new Date(2026, 9, 29, 8))).toEqual({ nudged: 0, smsFailed: 0 }); // too early
    expect(await run(new Date(2026, 9, 29, 12))).toEqual({ nudged: 1, smsFailed: 0 }); // Ana: 14 days
    expect(smsOutbox).toEqual([
      {
        to: '0722000001',
        text: expect.stringContaining('ne e dor de tine! N-ai mai fost la antrenament de 14 zile'),
      },
    ]);
    expect(await run(new Date(2026, 9, 30, 12))).toEqual({ nudged: 0, smsFailed: 0 }); // once

    // Ion is frozen: no nudge although he is away too.
    await staff
      .post(`/api/members/${ion.id}/freezes`)
      .send({ from: '2026-11-05', days: 10 })
      .expect(201);
    expect(await run(new Date(2026, 10, 9, 12))).toEqual({ nudged: 0, smsFailed: 0 });

    const inbox = await (await portal(ana)).get('/api/account/notifications').expect(200);
    expect(inbox.body[0]).toMatchObject({ title: 'Ne e dor de tine!' });
  });

  it('stays quiet while switched off', async () => {
    const ana = await createMember();
    setNow(new Date(2026, 10, 20, 12));
    expect(await run(new Date(2026, 10, 20, 12))).toEqual({ nudged: 0, smsFailed: 0 });
    expect(ana.id).toBeTruthy();
  });
});
