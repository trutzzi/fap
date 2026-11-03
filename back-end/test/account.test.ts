import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MEMBER_SESSION_COOKIE } from '../src/modules/account/member-sessions.js';
import { app, db, resetData, setNow, signedIn, smsControl, smsOutbox } from './helpers.js';

/** Signed in as reception, who adds members and hands out access. */
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
  return res.body as {
    id: string;
    hasAccount: boolean;
    access: { sms: string; phone: string; temporaryPin: string | null };
  };
}

/** A valid PIN that is not `pin`. */
const otherPin = (pin: string) => (pin === '000000' ? '111111' : '000000');

/** The PIN in the last SMS. */
const smsPin = () => /PIN de membru este (\d{6})\./.exec(smsOutbox.at(-1)!.text)![1];

const login = (phone: string, pin: string) =>
  request(app).post('/api/account/login').send({ phone, pin });

/** A member portal agent (cookie only, no staff session). */
async function memberAgent(phone: string, pin: string) {
  const res = await login(phone, pin).expect(200);
  const cookie = ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${MEMBER_SESSION_COOKIE}=`))!;
  expect(cookie).toMatch(/HttpOnly/i);
  return request.agent(app).set('Cookie', cookie.split(';')[0]);
}

/** SMS sending is off by default (club settings). */
const setSms = (smsEnabled: boolean) =>
  db.club.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      name: 'Fight Academy',
      address: '',
      phone: '',
      email: '',
      website: '',
      timezone: 'Europe/Bucharest',
      smsEnabled,
    },
    update: { smsEnabled },
  });

beforeEach(async () => {
  await resetData();
  staff = await signedIn('reception');
  await setSms(true);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('member access by SMS', () => {
  it('texts a generated 6-digit PIN when a member is added', async () => {
    const member = await createMember();
    expect(member.hasAccount).toBe(true);
    expect(member.access).toEqual({
      sms: 'sent',
      phone: '0722 513 418',
      temporaryPin: null,
    });
    expect(smsOutbox).toHaveLength(1);
    expect(smsOutbox[0].to).toBe('0722513418');
    expect(smsOutbox[0].text).toContain('https://club.test/cont');
    // Stored hashed only.
    const row = await db.member.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(smsPin());
  });

  it('shows reception the PIN when the SMS fails, and logs the failure', async () => {
    smsControl.fails = true;
    const member = await createMember();
    expect(member.access.sms).toBe('failed');
    expect(member.access.temporaryPin).toMatch(/^\d{6}$/);
    const errors = await db.errorLog.findMany();
    expect(errors).toMatchObject([{ source: 'sms', message: expect.stringContaining('ERROR;8') }]);
    await login('0722513418', member.access.temporaryPin!).expect(200);
  });

  it('sends no SMS while SMS sending is off in the club settings', async () => {
    await setSms(false);
    const member = await createMember();
    expect(member.access).toMatchObject({
      sms: 'disabled',
      temporaryPin: expect.stringMatching(/^\d{6}$/),
    });
    expect(smsOutbox).toHaveLength(0);
    expect(await db.errorLog.count()).toBe(0);
    await login('0722513418', member.access.temporaryPin!).expect(200);
  });

  it('reports SMS turned on without SMSLink credentials', async () => {
    smsControl.unconfigured = true;
    const member = await createMember();
    expect(member.access.sms).toBe('failed');
    expect(member.access.temporaryPin).toMatch(/^\d{6}$/);
    expect(await db.errorLog.findMany()).toMatchObject([
      { source: 'sms', message: expect.stringContaining('SMSLINK_') },
    ]);
  });

  it('issues a new PIN on request and signs the member out', async () => {
    const member = await createMember();
    const first = smsPin();
    const portal = await memberAgent('0722 513 418', first);

    const res = await staff.post(`/api/members/${member.id}/access`).send({}).expect(200);
    expect(res.body).toMatchObject({ sms: 'sent', temporaryPin: null });
    const second = smsPin();
    expect(second).not.toBe(first);

    await portal.get('/api/account').expect(401);
    await login('0722513418', first).expect(401);
    await login('0722513418', second).expect(200);
  });

  it('is for staff only, not for coaches', async () => {
    const member = await createMember();
    const coach = await signedIn('coach');
    await coach.post(`/api/members/${member.id}/access`).send({}).expect(403);
    await staff.post('/api/members/nope/access').send({}).expect(404);
  });
});

describe('member portal', () => {
  it('signs in with the phone in any format and shows only the member’s own data', async () => {
    await createMember();
    const portal = await memberAgent('+40 722 513 418', smsPin());
    const res = await portal.get('/api/account').expect(200);
    expect(res.body).toMatchObject({
      fullName: 'Andrei Popescu',
      phone: '0722 513 418',
      status: 'active',
      subscription: { planId: 'sessions12', used: 0, remaining: 12 },
      history: [],
    });
    expect(res.body).not.toHaveProperty('rfid');
    // A member session is not a staff session.
    await portal.get('/api/members').expect(401);
    await portal.post('/api/checkins').send({ memberId: res.body.id }).expect(401);
  });

  it('rejects wrong PINs and unknown phones the same way', async () => {
    await createMember();
    const pin = smsPin();
    for (const [phone, attempt] of [
      ['0722513418', otherPin(pin)],
      ['0700000000', pin],
    ]) {
      const res = await login(phone, attempt).expect(401);
      expect(res.body).toEqual({ message: 'Număr de telefon sau PIN greșit.' });
    }
    const malformed = await login('0722513418', 'parola-lunga').expect(400);
    expect(malformed.body.message).toBe('PIN-ul are 4–6 cifre.');
    await request(app).get('/api/account').expect(401);
  });

  it('lets siblings who share a phone sign in to their own accounts', async () => {
    await createMember({ firstName: 'Ana' });
    const ana = smsPin();
    await createMember({ firstName: 'Ioana', phone: '+40722513418' });
    const ioana = smsPin();
    expect(ioana).not.toBe(ana); // PINs are unique per phone
    const portal = await memberAgent('0722513418', ioana);
    expect((await portal.get('/api/account').expect(200)).body.firstName).toBe('Ioana');
    const other = await (await memberAgent('0722513418', ana)).get('/api/account').expect(200);
    expect(other.body.firstName).toBe('Ana');

    // Ioana can't pick Ana's PIN: it would no longer tell them apart.
    const taken = await portal
      .put('/api/account/pin')
      .send({ currentPin: ioana, newPin: ana })
      .expect(400);
    expect(taken.body.message).toBe('Acest PIN nu poate fi folosit. Alege altul.');
  });

  it('changes the PIN and signs out other devices only', async () => {
    await createMember();
    const pin = smsPin();
    const phone = await memberAgent('0722513418', pin);
    const tablet = await memberAgent('0722513418', pin);

    const wrong = await phone
      .put('/api/account/pin')
      .send({ currentPin: otherPin(pin), newPin: '2580' })
      .expect(400);
    expect(wrong.body.message).toBe('PIN-ul actual este greșit.');
    for (const newPin of ['123', '1234567', '12a4']) {
      const res = await phone.put('/api/account/pin').send({ currentPin: pin, newPin }).expect(400);
      expect(res.body.message).toBe('PIN-ul are 4–6 cifre.');
    }
    await phone.put('/api/account/pin').send({ currentPin: pin, newPin: '2580' }).expect(204);

    await phone.get('/api/account').expect(200);
    await tablet.get('/api/account').expect(401);
    await login('0722513418', '2580').expect(200);
  });

  it('logs out', async () => {
    await createMember();
    const portal = await memberAgent('0722513418', smsPin());
    await portal.post('/api/account/logout').send({}).expect(204);
    await portal.get('/api/account').expect(401);
    expect(await db.memberSession.count()).toBe(0);
  });
});

describe('QR check-in', () => {
  it('admits a member with their rotating QR code at the kiosk', async () => {
    const member = await createMember();
    const portal = await memberAgent('0722513418', smsPin());
    const qr = await portal.get('/api/account/qr').expect(200);
    expect(qr.headers['cache-control']).toBe('no-store');
    expect(qr.body.token).toMatch(/^FA1\./);
    expect(qr.body.refreshSeconds).toBe(30);

    const kiosk = await signedIn('coach');
    const res = await kiosk.post('/api/checkins').send({ qr: qr.body.token }).expect(200);
    expect(res.body).toMatchObject({ outcome: 'allowed', member: { id: member.id } });
    const again = await kiosk.post('/api/checkins').send({ qr: qr.body.token }).expect(200);
    expect(again.body.outcome).toBe('already-checked-in');

    const detail = await staff.get(`/api/members/${member.id}`).expect(200);
    expect(detail.body.history).toMatchObject([{ method: 'qr', sessionNumber: 1 }]);
    const account = await portal.get('/api/account').expect(200);
    expect(account.body.history).toMatchObject([{ method: 'qr' }]);
  });

  it('refuses expired, forged and malformed codes', async () => {
    await createMember();
    const portal = await memberAgent('0722513418', smsPin());
    const { token, expiresAt } = (await portal.get('/api/account/qr').expect(200)).body as {
      token: string;
      expiresAt: string;
    };
    const kiosk = await signedIn('reception');
    const forged = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    for (const qr of [forged, 'FA1.nope.abc.0123456789abcdef', 'FA1.garbage']) {
      const res = await kiosk.post('/api/checkins').send({ qr }).expect(200);
      expect(res.body).toEqual({ outcome: 'invalid-qr', member: null, trainingLabel: null });
    }
    setNow(new Date(expiresAt));
    const expired = await kiosk.post('/api/checkins').send({ qr: token }).expect(200);
    expect(expired.body.outcome).toBe('invalid-qr');
    expect(await db.checkIn.count()).toBe(0);
  });
});
