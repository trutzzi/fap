import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { SESSION_COOKIE, createSession } from '../src/modules/auth/sessions.js';
import { USERS, db, resetData } from './helpers.js';

beforeEach(resetData);
afterAll(async () => {
  await db.$disconnect();
});

describe('request logging', () => {
  it('never writes session cookies, query strings or response cookies', async () => {
    let output = '';
    const sink = new Writable({
      write(chunk, _encoding, done) {
        output += String(chunk);
        done();
      },
    });
    const app = createApp({ db, clock: () => new Date(2026, 9, 14, 19, 45), logger: pino(sink) });
    const { token } = await createSession(db, USERS.admin.id, new Date(2026, 9, 14, 19, 45));

    await request(app)
      .get('/api/members?q=Andrei%20Popescu&filter=all')
      .set('Cookie', `${SESSION_COOKIE}=${token}`)
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.ro', password: 'parola-gresita' })
      .expect(401);
    await request(app).get('/health').expect(200);

    expect(output).toContain('"path":"/api/members"');
    expect(output).not.toContain(token);
    expect(output).not.toContain('Andrei');
    expect(output).not.toContain('parola-gresita');
    expect(output).not.toMatch(/cookie/i);
    expect(output).not.toContain('/health');
  });
});
