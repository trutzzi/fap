import type { Request, RequestHandler } from 'express';
import type { Role } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { HttpError } from '../../lib/http-error.js';
import { readSessionToken, resolveSession, setSessionCookie } from './sessions.js';

/** Attaches `req.user` when the session cookie is valid; never rejects on its own. */
export function authenticate({ db, clock }: Deps): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req);
    if (token) {
      const session = await resolveSession(db, token, clock());
      if (session) {
        req.user = session.user;
        if (session.renewed) setSessionCookie(res, token, session.expiresAt);
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.user ? undefined : new HttpError(401, 'Autentifică-te pentru a continua.'));
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Autentifică-te pentru a continua.'));
    next(
      roles.includes(req.user.role)
        ? undefined
        : new HttpError(403, 'Nu ai drepturi pentru această acțiune.'),
    );
  };
}

export const requireAdmin = requireRole('admin');

/** In-handler variant of `requireAdmin`, for routes whose param types must stay inferred. */
export function assertAdmin(req: Request): void {
  if (req.user?.role !== 'admin')
    throw new HttpError(403, 'Nu ai drepturi pentru această acțiune.');
}

/**
 * CSRF defence for cookie auth: browsers cannot send a cross-site request with a JSON or
 * image content type without a CORS preflight (which this API never grants), so
 * state-changing requests must be JSON, or an image for photo uploads.
 * Combined with the SameSite=Lax cookie.
 */
export const requireJsonForMutations: RequestHandler = (req, _res, next) => {
  const mutates = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
  const allowed = req.is(['application/json', 'image/jpeg', 'image/png', 'image/webp']);
  next(mutates && !allowed ? new HttpError(415, 'Cererea trebuie să fie JSON.') : undefined);
};

/** What a coach may call: read-only views of their classes, the schedule, and check-in. */
const COACH_ALLOWED: [method: string, path: RegExp][] = [
  ['GET', /^\/trainings\/today$/],
  ['GET', /^\/members\/[^/]+\/photo$/],
  ['GET', /^\/schedule$/],
  ['GET', /^\/courses$/],
  ['GET', /^\/slots$/],
  ['GET', /^\/kiosk\/status$/],
  ['POST', /^\/checkins$/],
];

/**
 * Coaches get an allowlist; everything else (members' personal data, prices, settings)
 * stays staff-only. Mounted after `requireAuth`, with paths relative to `/api`.
 */
export const restrictCoaches: RequestHandler = (req, _res, next) => {
  const ok =
    req.user?.role !== 'coach' ||
    COACH_ALLOWED.some(([method, path]) => method === req.method && path.test(req.path));
  next(ok ? undefined : new HttpError(403, 'Nu ai drepturi pentru această acțiune.'));
};
