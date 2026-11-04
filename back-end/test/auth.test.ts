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
      smsEnabled: true,
      kioskVolume: 35,
    };
    await admin.put('/api/club').send(club).expect(200);
    expect((await request(app).get('/api/club')).body).toEqual(club);

    const bad = await admin
      .put('/api/club')
      .send({ ...club, timezone: 'Mars/Olympus' })
      .expect(400);
    expect(bad.body.message).toBe('Fusul orar este invalid.');
    const loud = await admin
      .put('/api/club')
      .send({ ...club, kioskVolume: 150 })
      .expect(400);
    expect(loud.body.message).toBe('Volumul trebuie să fie un număr între 0 și 100.');
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

describe('staff passwords', () => {
  const NEW = 'parola-noua-sigura';

  it('lets any staff user change their own password, signing out their other devices', async () => {
    const desk = await signedIn('reception');
    const tablet = await signedIn('reception');
    const wrong = await desk
      .put('/api/auth/password')
      .send({ currentPassword: 'gresit', newPassword: NEW })
      .expect(400);
    expect(wrong.body.message).toBe('Parola actuală este greșită.');
    const short = await desk
      .put('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'scurta' })
      .expect(400);
    expect(short.body.message).toBe('Parola nouă trebuie să aibă cel puțin 10 caractere.');

    await desk
      .put('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW })
      .expect(204);
    await desk.get('/api/auth/me').expect(200);
    await tablet.get('/api/auth/me').expect(401);
    await login('receptie@test.ro', PASSWORD).expect(401);
    await login('receptie@test.ro', NEW).expect(200);
    // Coaches too.
    const coach = await signedIn('coach');
    await coach
      .put('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW })
      .expect(204);
  });

  it('lets an admin list accounts and set a password, signing that account out', async () => {
    const admin = await signedIn('admin');
    const reception = await signedIn('reception');
    const list = await admin.get('/api/users').expect(200);
    expect(list.body).toEqual(
      expect.arrayContaining([
        {
          id: USERS.reception.id,
          email: 'receptie@test.ro',
          name: 'Recepție Test',
          role: 'reception',
          active: true,
          lastLoginAt: null,
        },
      ]),
    );
    expect(list.body[0]).not.toHaveProperty('passwordHash');

    await admin
      .put(`/api/users/${USERS.reception.id}/password`)
      .send({ password: NEW })
      .expect(204);
    await reception.get('/api/auth/me').expect(401);
    await login('receptie@test.ro', NEW).expect(200);

    // Setting their own password keeps the admin signed in.
    await admin.put(`/api/users/${USERS.admin.id}/password`).send({ password: NEW }).expect(204);
    await admin.get('/api/auth/me').expect(200);
    await admin.put('/api/users/nope/password').send({ password: NEW }).expect(404);
  });

  it('lets an admin create an account that can sign in', async () => {
    const admin = await signedIn('admin');
    const input = { name: ' Ana Pop ', email: ' Ana@Club.ro ', role: 'reception', password: NEW };
    const res = await admin.post('/api/users').send(input).expect(201);
    expect(res.body).toMatchObject({
      name: 'Ana Pop',
      email: 'ana@club.ro',
      role: 'reception',
      active: true,
      lastLoginAt: null,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    await login('ana@club.ro', NEW).expect(200);

    const duplicate = await admin.post('/api/users').send(input).expect(409);
    expect(duplicate.body.message).toBe('Există deja un cont pentru ana@club.ro.');
    for (const [field, value, message] of [
      ['email', 'nu-e-email', 'Adresa de email este invalidă.'],
      ['role', 'owner', 'Rolul este invalid.'],
      ['password', 'scurta', 'Parola trebuie să aibă cel puțin 10 caractere.'],
      ['name', ' ', 'Numele este obligatoriu.'],
    ]) {
      const bad = await admin
        .post('/api/users')
        .send({ ...input, email: 'alt@club.ro', [field]: value })
        .expect(400);
      expect(bad.body.message).toBe(message);
    }
  });

  it('keeps accounts admin-only', async () => {
    const reception = await signedIn('reception');
    await reception.get('/api/users').expect(403);
    await reception
      .post('/api/users')
      .send({ name: 'X', email: 'x@club.ro', role: 'admin', password: 'parola-noua-sigura' })
      .expect(403);
    await reception
      .put(`/api/users/${USERS.admin.id}/password`)
      .send({ password: 'parola-noua-sigura' })
      .expect(403);
  });
});
