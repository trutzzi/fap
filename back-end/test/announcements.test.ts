import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBER_SESSION_COOKIE } from '../src/modules/account/member-sessions.js';
import { app, db, resetData, setNow, signedIn, smsControl, smsOutbox } from './helpers.js';

let staff: Awaited<ReturnType<typeof signedIn>>;

async function createMember(firstName: string, phone: string, extra: Record<string, unknown> = {}) {
  const res = await staff
    .post('/api/members')
    .send({ firstName, lastName: 'Test', phone, courseIds: [], ...extra })
    .expect(201);
  return res.body as { id: string; access: { temporaryPin: string } };
}

/** A member portal agent for `member` (SMS is off by default, so the PIN comes back). */
async function portal(member: { access: { temporaryPin: string } }, phone: string) {
  const res = await request(app)
    .post('/api/account/login')
    .send({ phone, pin: member.access.temporaryPin })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${MEMBER_SESSION_COOKIE}=`))!;
  return request.agent(app).set('Cookie', cookie.split(';')[0]);
}

const send = (audience: unknown, title = 'Program de sărbători') =>
  staff
    .post('/api/announcements')
    .send({ title, body: 'Sala este închisă pe 1 decembrie.', audience });

beforeEach(async () => {
  await resetData();
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('announcements', () => {
  it('sends to all members, a course, valid subscriptions or chosen members', async () => {
    const ana = await createMember('Ana', '0722000001', {
      courseIds: ['kb'],
      subscription: { planId: 'unlimited', startDate: '2026-10-01' },
    });
    const ion = await createMember('Ion', '0722000002');

    const all = await send({ kind: 'all' }).expect(201);
    expect(all.body).toMatchObject({
      title: 'Program de sărbători',
      audienceLabel: 'Toți membrii',
      createdBy: 'Recepție Test',
      recipients: 2,
      read: 0,
    });
    expect((await send({ kind: 'course', courseId: 'kb' }).expect(201)).body).toMatchObject({
      audienceLabel: 'Curs: Kickboxing',
      recipients: 1,
    });
    expect((await send({ kind: 'active' }).expect(201)).body).toMatchObject({
      audienceLabel: 'Cu abonament valabil',
      recipients: 1,
    });
    expect(
      (await send({ kind: 'members', memberIds: [ion.id, ion.id, ana.id] }).expect(201)).body,
    ).toMatchObject({ audienceLabel: '2 membri aleși', recipients: 2 });

    const list = await staff.get('/api/announcements').expect(200);
    expect(list.body).toHaveLength(4);
  });

  it('validates the message and the recipients', async () => {
    await createMember('Ana', '0722000001');
    const cases: [object, string][] = [
      [{ title: ' ', body: 'x', audience: { kind: 'all' } }, 'Titlul este obligatoriu.'],
      [
        { title: 'x', body: 'y'.repeat(1001), audience: { kind: 'all' } },
        'Mesajul poate avea maximum 1000 caractere.',
      ],
      [
        { title: 'x', body: 'y', audience: { kind: 'members', memberIds: [] } },
        'Alege cel puțin un membru.',
      ],
      [
        { title: 'x', body: 'y', audience: { kind: 'course', courseId: 'nope' } },
        'Cursul ales nu există.',
      ],
      [
        { title: 'x', body: 'y', audience: { kind: 'members', memberIds: ['nope'] } },
        'Unul dintre membri nu există.',
      ],
      [
        { title: 'x', body: 'y', audience: { kind: 'active' } },
        'Niciun membru nu corespunde destinatarilor aleși.',
      ],
    ];
    for (const [input, message] of cases) {
      const res = await staff.post('/api/announcements').send(input).expect(400);
      expect(res.body.message).toBe(message);
    }
  });

  it('is for staff only, not for coaches', async () => {
    const coach = await signedIn('coach');
    await coach.get('/api/announcements').expect(403);
    await coach.post('/api/announcements').send({}).expect(403);
  });

  it('shows members their announcements and tracks who read them', async () => {
    const ana = await createMember('Ana', '0722000001');
    const ion = await createMember('Ion', '0722000002');
    await send({ kind: 'all' }, 'Primul').expect(201);
    setNow(new Date(2026, 9, 14, 20, 0));
    const second = await send({ kind: 'members', memberIds: [ana.id] }, 'Doar pentru Ana').expect(
      201,
    );

    const anaPortal = await portal(ana, '0722000001');
    expect((await anaPortal.get('/api/account').expect(200)).body.unreadAnnouncements).toBe(2);
    const anaList = await anaPortal.get('/api/account/announcements').expect(200);
    expect(anaList.body.map((a: { title: string }) => a.title)).toEqual([
      'Doar pentru Ana',
      'Primul',
    ]);
    expect(anaList.body[0]).toMatchObject({
      read: false,
      body: 'Sala este închisă pe 1 decembrie.',
    });

    await anaPortal.post('/api/account/announcements/read').send({}).expect(204);
    expect((await anaPortal.get('/api/account').expect(200)).body.unreadAnnouncements).toBe(0);
    expect((await anaPortal.get('/api/account/announcements').expect(200)).body[0].read).toBe(true);

    const ionPortal = await portal(ion, '0722000002');
    const ionList = await ionPortal.get('/api/account/announcements').expect(200);
    expect(ionList.body.map((a: { title: string }) => a.title)).toEqual(['Primul']);

    const stats = await staff.get('/api/announcements').expect(200);
    expect(stats.body).toMatchObject([
      { id: second.body.id, recipients: 1, read: 1 },
      { title: 'Primul', recipients: 2, read: 1 },
    ]);

    // Deleting withdraws it from the members' portal.
    await staff.delete(`/api/announcements/${second.body.id}`).expect(204);
    await staff.delete(`/api/announcements/${second.body.id}`).expect(404);
    expect((await anaPortal.get('/api/account/announcements').expect(200)).body).toHaveLength(1);
  });

  it('does not send announcements to members who join later', async () => {
    await createMember('Ana', '0722000001');
    await send({ kind: 'all' }).expect(201);
    const late = await createMember('Ion', '0722000002');
    const ionPortal = await portal(late, '0722000002');
    expect((await ionPortal.get('/api/account/announcements').expect(200)).body).toEqual([]);
  });

  it('also texts it once per phone number, in the background', async () => {
    await createMember('Ana', '0722000001');
    await createMember('Ioana', '+40 722 000 001'); // sister, same phone
    await createMember('Ion', '0722000002');
    const long = 'Sala este închisă pe 1 decembrie. '.repeat(10);
    const res = await staff
      .post('/api/announcements')
      .send({ title: 'Program de sărbători', body: long, audience: { kind: 'all' }, sms: true })
      .expect(201);
    expect(res.body.recipients).toBe(3);
    expect(res.body.sms).toMatchObject({ recipients: 2 });

    const done = await waitForSms(res.body.id);
    expect(done).toEqual({ recipients: 2, sent: 2, failed: 0 });
    expect(smsOutbox.map((m) => m.to).sort()).toEqual(['0722000001', '0722000002']);
    const text = smsOutbox[0].text;
    expect(text.length).toBeLessThanOrEqual(160);
    expect(text).toMatch(/^Fight Academy: Program de sarbatori\. Sala este inchisa/);
    expect(text).toMatch(/\.\.\. Detalii: https:\/\/club\.test\/cont$/);

    // Without the option nothing is texted.
    const plain = await send({ kind: 'all' }).expect(201);
    expect(plain.body.sms).toBeNull();
  });

  it('counts failed SMS and logs them once', async () => {
    await createMember('Ana', '0722000001');
    await createMember('Ion', '0722000002');
    smsControl.fails = true;
    const res = await staff
      .post('/api/announcements')
      .send({ title: 'Test', body: 'Scurt.', audience: { kind: 'all' }, sms: true })
      .expect(201);
    expect(await waitForSms(res.body.id)).toEqual({ recipients: 2, sent: 0, failed: 2 });
    await expect.poll(() => db.errorLog.count()).toBe(1);
    expect((await db.errorLog.findFirst())?.message).toContain('2 of 2 SMS failed');
  });
});

/** Polls the staff list until the background SMS sending finished. */
async function waitForSms(id: string) {
  for (let i = 0; i < 100; i++) {
    const list = await staff.get('/api/announcements').expect(200);
    const sms = list.body.find((a: { id: string }) => a.id === id)?.sms;
    if (sms && sms.sent + sms.failed >= sms.recipients) return sms;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('SMS sending did not finish');
}
