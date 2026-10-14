import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { toDbDate } from '../src/db.js';
import { USERS, db, resetData, setNow, signedIn } from './helpers.js';

/** Smallest valid JPEG header + filler; the API only checks the file signature. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

let staff: Awaited<ReturnType<typeof signedIn>>;

async function createMember(overrides: Record<string, unknown> = {}) {
  const res = await staff
    .post('/api/members')
    .send({
      firstName: 'Andrei',
      lastName: 'Popescu',
      phone: '0722 513 418',
      courseIds: ['kb'],
      subscription: { planId: 'sessions12', startDate: '2026-10-01' },
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string; photoUrl: string | null };
}

beforeEach(async () => {
  await resetData();
  // Kickboxing (Wed 20:00) belongs to the coach; BJJ (Wed 20:15) to nobody.
  await db.course.update({ where: { id: 'kb' }, data: { coachUserId: USERS.coach.id } });
  await db.course.create({
    data: { id: 'bjj', name: 'BJJ', color: '#5b9cff', coach: 'Alt Antrenor' },
  });
  await db.trainingSlot.create({
    data: {
      id: 'bjj-wed',
      courseId: 'bjj',
      weekday: 3,
      time: '20:15',
      durationMin: 60,
      capacity: 20,
    },
  });
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('member photos', () => {
  it('requires consent, checks the file type and serves the image privately', async () => {
    const { id } = await createMember();
    const denied = await staff
      .put(`/api/members/${id}/photo`)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG);
    expect(denied.status).toBe(409);
    expect(denied.body.message).toContain('acordul pentru fotografie');

    const member = await staff.get(`/api/members/${id}`);
    await staff
      .put(`/api/members/${id}`)
      .send({ ...member.body, courseIds: ['kb'], photoConsent: true })
      .expect(200);

    const fake = await staff
      .put(`/api/members/${id}/photo`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not really a png'));
    expect(fake.status).toBe(400);

    const saved = await staff
      .put(`/api/members/${id}/photo`)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    expect(saved.body.photoUrl).toMatch(new RegExp(`^/api/members/${id}/photo\\?v=\\d+$`));

    const image = await staff.get(`/api/members/${id}/photo`).buffer(true).expect(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('private, max-age=86400');
    expect(Buffer.compare(image.body as Buffer, JPEG)).toBe(0);
  });

  it('deletes the photo when consent is withdrawn', async () => {
    const { id } = await createMember({ photoConsent: true });
    await staff
      .put(`/api/members/${id}/photo`)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    const member = await staff.get(`/api/members/${id}`);
    const updated = await staff
      .put(`/api/members/${id}`)
      .send({ ...member.body, courseIds: ['kb'], photoConsent: false })
      .expect(200);
    expect(updated.body.photoUrl).toBeNull();
    expect(await db.memberPhoto.count()).toBe(0);
  });

  it('rejects oversized uploads', async () => {
    const { id } = await createMember({ photoConsent: true });
    const big = Buffer.concat([JPEG, Buffer.alloc(1024 * 1024)]);
    const res = await staff
      .put(`/api/members/${id}/photo`)
      .set('Content-Type', 'image/jpeg')
      .send(big);
    expect(res.status).toBe(413);
  });
});

describe('class attendance', () => {
  it('lists admitted members and refused scans per training, without counting refusals', async () => {
    const ok = await createMember({ firstName: 'Ana', rfid: 'AAAA0001' });
    const full = await createMember({ firstName: 'Bogdan', rfid: 'BBBB0002' });
    await db.checkIn.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        memberId: full.id,
        date: toDbDate(`2026-10-${String(i + 1).padStart(2, '0')}`),
        timestamp: new Date(2026, 9, i + 1, 19, 55),
        method: 'rfid' as const,
      })),
    });

    setNow(new Date(2026, 9, 14, 19, 50));
    expect((await staff.post('/api/checkins').send({ rfid: 'AAAA0001' })).body.outcome).toBe(
      'allowed',
    );
    expect((await staff.post('/api/checkins').send({ rfid: 'BBBB0002' })).body.outcome).toBe(
      'limit',
    );
    setNow(new Date(2026, 9, 14, 19, 52));
    await staff.post('/api/checkins').send({ rfid: 'BBBB0002' }); // second tap is merged
    expect(await db.refusedScan.count()).toBe(1);

    const res = await staff.get('/api/trainings/today').expect(200);
    const kb = res.body.trainings.find((t: { slotId: string }) => t.slotId === 'kb-wed');
    expect(kb.checkins).toBe(1);
    expect(kb.attendees).toEqual([
      expect.objectContaining({
        memberId: ok.id,
        refused: null,
        status: 'active',
        usageLabel: '11 ședințe rămase',
      }),
      expect.objectContaining({
        memberId: full.id,
        refused: 'limit',
        status: 'limit',
        usageLabel: 'Nicio ședință rămasă',
      }),
    ]);
    // The refusal did not use a session.
    expect((await staff.get(`/api/members/${full.id}`)).body.subscription.used).toBe(12);

    const dashboard = await staff.get('/api/dashboard').expect(200);
    expect(dashboard.body.today[0].attendees).toHaveLength(2);
    expect(dashboard.body.openGym).toEqual([]);
  });
});

describe('coach access', () => {
  it('sees only their own trainings and attendees', async () => {
    await createMember({ rfid: 'AAAA0001' });
    setNow(new Date(2026, 9, 14, 19, 50));
    await staff.post('/api/checkins').send({ rfid: 'AAAA0001' });

    const coach = await signedIn('coach');
    const res = await coach.get('/api/trainings/today').expect(200);
    expect(res.body.trainings.map((t: { slotId: string }) => t.slotId)).toEqual(['kb-wed']);
    expect(res.body.trainings[0].attendees).toHaveLength(1);
    expect(res.body.openGym).toEqual([]);
  });

  it('cannot read personal data, prices or settings, nor change anything but check-ins', async () => {
    const coach = await signedIn('coach');
    const { id } = await createMember();
    const forbidden = [
      () => coach.get('/api/members'),
      () => coach.get(`/api/members/${id}`),
      () => coach.get('/api/dashboard'),
      () => coach.get('/api/plans'),
      () => coach.get('/api/users/coaches'),
      () => coach.put(`/api/members/${id}/photo`).set('Content-Type', 'image/jpeg').send(JPEG),
      () => coach.post('/api/courses').send({ name: 'X', coach: 'Y', color: '#123456' }),
    ];
    for (const send of forbidden) {
      expect((await send()).status).toBe(403);
    }
    await coach.get('/api/schedule').expect(200);
    await coach.get('/api/kiosk/status').expect(200);
    await coach.post('/api/checkins').send({ memberId: id }).expect(200);
  });

  it('sees photos only of members in their courses', async () => {
    const mine = await createMember({ photoConsent: true });
    const other = await createMember({ firstName: 'Ion', courseIds: ['bjj'], photoConsent: true });
    for (const m of [mine, other]) {
      await staff
        .put(`/api/members/${m.id}/photo`)
        .set('Content-Type', 'image/jpeg')
        .send(JPEG)
        .expect(200);
    }
    const coach = await signedIn('coach');
    await coach.get(`/api/members/${mine.id}/photo`).expect(200);
    await coach.get(`/api/members/${other.id}/photo`).expect(403);
  });

  it('links courses only to active coach accounts', async () => {
    const admin = await signedIn('admin');
    const coaches = await admin.get('/api/users/coaches').expect(200);
    expect(coaches.body).toEqual([{ id: USERS.coach.id, name: 'Albu Marius' }]);
    const bad = await admin
      .put('/api/courses/bjj')
      .send({ name: 'BJJ', coach: 'X', color: '#5b9cff', coachUserId: USERS.reception.id })
      .expect(400);
    expect(bad.body.message).toBe('Contul de antrenor selectat nu există.');
  });
});
