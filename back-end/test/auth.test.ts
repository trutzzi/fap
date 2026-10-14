import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/modules/auth/sessions.js';
import { PASSWORD, USERS, app, db, resetData, signedIn } from './helpers.js';

const login = (email: string, password: string) =>
  request(app).post('/api/auth/login').send({ email, password });

const sessionCookie = (res: request.Response) =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));

beforeEach(resetData);
afterAll(async () => {
  await db.$disconnect();
});

describe('login', () => {
  it('signs in with a valid password and sets an httpOnly session cookie', async () => {
    const res = await login(' Admin@Test.ro ', PASSWORD).expect(200);
    expect(res.body).toEqual({
      id: 'u-admin',
      email: 'admin@test.ro',
      name: 'Admin Test',
      role: 'admin',
    });
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    expect(me.body.role).toBe('admin');
    // Only the token's hash is stored.
    const token = cookie.split(';')[0].split('=')[1];
    expect(await db.session.count({ where: { id: token } })).toBe(0);
    expect(await db.session.count()).toBe(1);
  });

  it('rejects wrong passwords, unknown emails and deactivated accounts the same way', async () => {
    await db.user.update({ where: { id: USERS.reception.id }, data: { active: false } });
    for (const [email, password] of [
      ['admin@test.ro', 'gresit'],
      ['nimeni@test.ro', PASSWORD],
      ['receptie@test.ro', PASSWORD],
    ] as const) {
      const res = await login(email, password).expect(401);
      expect(res.body).toEqual({ message: 'Email sau parolă greșită.' });
      expect(sessionCookie(res)).toBeUndefined();
    }
  });

  it('blocks an email after repeated failures', async () => {
    // The limiter lives as long as the app, so use an email no other test touches.
    for (let i = 0; i < 10; i++) await login('blocat@test.ro', `gresit-${i}`).expect(401);
    const blocked = await login('blocat@test.ro', PASSWORD).expect(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // Other accounts from the same IP are unaffected.
    await login('admin@test.ro', PASSWORD).expect(200);
  });

  it('logs out and invalidates the session', async () => {
    const agent = await signedIn('admin');
    await agent.post('/api/auth/logout').send({}).expect(204);
    await agent.get('/api/auth/me').expect(401);
    expect(await db.session.count()).toBe(0);
  });
});

describe('access control', () => {
  it('requires a session for the API but not for the club details', async () => {
    const res = await request(app).get('/api/members').expect(401);
    expect(res.body.message).toBe('Autentifică-te pentru a continua.');
    await request(app).get('/api/club').expect(200);
    await request(app).get('/api/dashboard').expect(401);
  });

  it('lets reception work with members and check-ins but not settings', async () => {
    const reception = await signedIn('reception');
    const member = await reception
      .post('/api/members')
      .send({ firstName: 'Ion', lastName: 'Pop', phone: '0722 000 000', courseIds: ['kb'] })
      .expect(201);
    await reception.post('/api/checkins').send({ memberId: member.body.id }).expect(200);
    await reception.get('/api/courses').expect(200);

    const denied = [
      reception.post('/api/courses').send({ name: 'X', coach: 'Y', color: '#123456' }),
      reception.delete('/api/slots/kb-wed'),
      reception
        .put('/api/plans/unlimited')
        .send({ name: 'N', description: '', sessionLimit: null, price: 1 }),
      reception.put('/api/club').send({ name: 'X', timezone: 'Europe/Bucharest' }),
      reception.delete(`/api/members/${member.body.id}`),
    ];
    for (const res of await Promise.all(denied)) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Nu ai drepturi pentru această acțiune.');
    }
  });

  it('rejects state-changing requests that are not JSON (CSRF defence)', async () => {
    const agent = await signedIn('admin');
    const res = await agent
      .post('/api/courses')
      .set('Content-Type', 'text/plain')
      .send('{"name":"X","coach":"Y","color":"#123456"}');
    expect(res.status).toBe(415);
  });
});

describe('admin settings', () => {
  it('saves club details and validates the timezone', async () => {
    const admin = await signedIn('admin');
    const club = {
      name: 'Fight Academy Pitești',
      address: 'Str. Constantin Brâncoveanu',
      phone: '+40 730 473 741',
      email: 'contact@fightacademy.ro',
      website: 'fightacademy.ro',
      timezone: 'Europe/Bucharest',
    };
    await admin.put('/api/club').send(club).expect(200);
    expect((await request(app).get('/api/club')).body).toEqual(club);

    const bad = await admin
      .put('/api/club')
      .send({ ...club, timezone: 'Mars/Olympus' })
      .expect(400);
    expect(bad.body.message).toBe('Fusul orar este invalid.');
  });

  it('edits plans and keeps the unlimited plan without a session limit', async () => {
    const admin = await signedIn('admin');
    const res = await admin
      .put('/api/plans/sessions12')
      .send({ name: '10 ședințe / lună', description: 'Pachet', sessionLimit: 10, price: 180 })
      .expect(200);
    expect(res.body).toMatchObject({ name: '10 ședințe / lună', sessionLimit: 10, price: 180 });

    const bad = await admin
      .put('/api/plans/unlimited')
      .send({ name: 'Nelimitat', description: '', sessionLimit: 5, price: 300 })
      .expect(400);
    expect(bad.body.message).toBe('Abonamentul nelimitat nu poate avea un număr de ședințe.');
  });

  it('lists the weekly template of training slots', async () => {
    const admin = await signedIn('admin');
    const res = await admin.get('/api/slots').expect(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 'kb-wed', weekday: 3, time: '20:00' }),
    ]);
  });
});
