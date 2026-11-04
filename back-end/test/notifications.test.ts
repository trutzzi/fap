import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBER_SESSION_COOKIE } from '../src/modules/account/member-sessions.js';
import { app, db, pushGone, pushOutbox, resetData, setNow, signedIn } from './helpers.js';

let staff: Awaited<ReturnType<typeof signedIn>>;

async function createMember(subscription: Record<string, unknown> | null) {
  const res = await staff
    .post('/api/members')
    .send({
      firstName: 'Ana',
      lastName: 'Pop',
      phone: '0722000001',
      courseIds: ['kb'],
      rfid: '04A391F2',
      subscription,
    })
    .expect(201);
  return res.body as { id: string; access: { temporaryPin: string } };
}

async function portal(pin: string) {
  const res = await request(app)
    .post('/api/account/login')
    .send({ phone: '0722000001', pin })
    .expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${MEMBER_SESSION_COOKIE}=`))!;
  return request.agent(app).set('Cookie', cookie.split(';')[0]);
}

const device = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } };
/** Pushes run in the background. */
const pushed = (n: number) => expect.poll(() => pushOutbox.length).toBe(n);

beforeEach(async () => {
  await resetData();
  staff = await signedIn('reception');
});

afterAll(async () => {
  await db.$disconnect();
});

describe('member notifications', () => {
  it('notifies the member of check-ins on the inbox and their phone', async () => {
    const member = await createMember({ planId: 'sessions12', startDate: '2026-10-01' });
    const phone = await portal(member.access.temporaryPin);
    expect((await phone.get('/api/account/push').expect(200)).body).toEqual({
      publicKey: 'test-public-key',
    });
    await phone.post('/api/account/push').send(device).expect(204);

    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    await pushed(1);
    expect(pushOutbox[0]).toEqual({
      endpoint: device.endpoint,
      payload: { title: 'Check-in confirmat', body: 'Kickboxing · ședința 1 din 12', url: '/cont' },
    });
    // A repeat tap for the same training is not news.
    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);

    const account = await phone.get('/api/account').expect(200);
    expect(account.body.unreadNotifications).toBe(1);
    const inbox = await phone.get('/api/account/notifications').expect(200);
    expect(inbox.body).toMatchObject([{ kind: 'checkin', read: false }]);
    await phone.post('/api/account/notifications/read').send({}).expect(204);
    expect((await phone.get('/api/account').expect(200)).body.unreadNotifications).toBe(0);
  });

  it('tells the member why a scan was refused', async () => {
    const member = await createMember({ planId: 'sessions12', startDate: '2026-08-01' });
    const phone = await portal(member.access.temporaryPin);
    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    const inbox = await phone.get('/api/account/notifications').expect(200);
    expect(inbox.body).toMatchObject([
      {
        kind: 'refused',
        title: 'Check-in refuzat',
        body: 'Abonamentul a expirat pe 31-08-2026. Reînnoiește-l la recepție.',
      },
    ]);
  });

  it('forgets devices that dropped the subscription, and unsubscribes', async () => {
    const member = await createMember({ planId: 'unlimited', startDate: '2026-10-01' });
    const phone = await portal(member.access.temporaryPin);
    await phone.post('/api/account/push').send(device).expect(204);
    pushGone.add(device.endpoint);
    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);
    await expect.poll(() => db.pushSubscription.count()).toBe(0);

    await phone.post('/api/account/push').send(device).expect(204);
    await phone
      .delete(`/api/account/push?endpoint=${encodeURIComponent(device.endpoint)}`)
      .expect(204);
    expect(await db.pushSubscription.count()).toBe(0);
    const bad = await phone.post('/api/account/push').send({ endpoint: 'http://x', keys: {} });
    expect(bad.status).toBe(400);
  });

  it('notifies the recipients of an announcement', async () => {
    const member = await createMember(null);
    const phone = await portal(member.access.temporaryPin);
    await staff
      .post('/api/announcements')
      .send({ title: 'Sală închisă', body: 'Pe 1 decembrie.', audience: { kind: 'all' } })
      .expect(201);
    const inbox = await phone.get('/api/account/notifications').expect(200);
    expect(inbox.body).toMatchObject([
      { kind: 'announcement', title: 'Anunț nou: Sală închisă', body: 'Pe 1 decembrie.' },
    ]);
  });
});

describe('staff bell', () => {
  it('lists check-ins, refused scans and SMS, with an unread count', async () => {
    await db.club.create({
      data: {
        id: 1,
        name: 'Fight Academy',
        address: '',
        phone: '',
        email: '',
        website: '',
        timezone: 'Europe/Bucharest',
        smsEnabled: true,
      },
    });
    await createMember({ planId: 'sessions12', startDate: '2026-10-01' }); // PIN SMS
    setNow(new Date(2026, 9, 14, 19, 50));
    await staff.post('/api/checkins').send({ rfid: '04A391F2' }).expect(200);

    const feed = await staff.get('/api/notifications').expect(200);
    expect(feed.body.unread).toBe(2);
    expect(feed.body.items).toMatchObject([
      { kind: 'checkin', memberName: 'Ana Pop', text: 'Check-in · Kickboxing' },
      { kind: 'sms-sent', memberName: 'Ana Pop', text: 'SMS cod PIN către 0722000001' },
    ]);

    await staff.post('/api/notifications/seen').send({}).expect(204);
    expect((await staff.get('/api/notifications').expect(200)).body.unread).toBe(0);
    const coach = await signedIn('coach');
    await coach.get('/api/notifications').expect(403);
  });
});

describe('SMS credit and bulk preview', () => {
  it('shows staff the SMS left, and how many SMS an announcement would use', async () => {
    const credit = await staff.get('/api/sms/credit').expect(200);
    expect(credit.body).toEqual({ configured: true, credit: 500, error: null });
    const coach = await signedIn('coach');
    await coach.get('/api/sms/credit').expect(403);

    await createMember(null);
    await staff
      .post('/api/members')
      .send({ firstName: 'Ioana', lastName: 'Pop', phone: '+40722000001', courseIds: [] })
      .expect(201); // sister on the same phone
    const preview = await staff
      .post('/api/announcements/preview')
      .send({ audience: { kind: 'all' } })
      .expect(200);
    expect(preview.body).toEqual({ recipients: 2, smsCount: 1 });
  });
});
