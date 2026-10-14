import { Router } from 'express';
import type { AuthUser } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { HttpError } from '../../lib/http-error.js';
import { verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { loginSchema, parse } from '../../lib/validation.js';
import { requireAuth } from './auth.middleware.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  pruneSessions,
  readSessionToken,
  setSessionCookie,
} from './sessions.js';

/**
 * Failed logins allowed in a 15-minute window: few per account (stops guessing one
 * password), more per IP (a whole reception desk may share one address).
 */
const LOGIN_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_EMAIL = 10;
const MAX_FAILURES_PER_IP = 50;

export function authRouter({ db, clock }: Deps): Router {
  const router = Router();
  const byEmail = new RateLimiter(MAX_FAILURES_PER_EMAIL, LOGIN_WINDOW_MS);
  const byIp = new RateLimiter(MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS);

  router.post('/login', async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const checks = [
      [byEmail, email],
      [byIp, req.ip ?? 'unknown'],
    ] as const;
    const blocked = checks.find(([limiter, key]) => limiter.isBlocked(key));
    if (blocked) {
      res.setHeader('Retry-After', String(blocked[0].retryAfter(blocked[1])));
      throw new HttpError(429, 'Prea multe încercări eșuate. Încearcă din nou în câteva minute.');
    }

    const user = await db.user.findUnique({ where: { email } });
    const valid =
      user && user.active
        ? await verifyPassword(password, user.passwordHash)
        : await verifyAgainstDummy(password);
    if (!user || !valid) {
      checks.forEach(([limiter, key]) => limiter.record(key));
      throw new HttpError(401, 'Email sau parolă greșită.');
    }

    byEmail.reset(email);
    const now = clock();
    await pruneSessions(db, now);
    const { token, expiresAt } = await createSession(db, user.id, now);
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    setSessionCookie(res, token, expiresAt);
    const body: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    res.json(body);
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) await deleteSession(db, token);
    clearSessionCookie(res);
    res.status(204).end();
  });

  return router;
}
