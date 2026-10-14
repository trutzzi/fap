import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthUser } from '../../contract/models.js';
import type { Db } from '../../db.js';

export const SESSION_COOKIE = 'fa_session';
/** Sessions last 14 days and are extended on use once less than half remains. */
const SESSION_TTL_MS = 14 * 24 * 3_600_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(
  db: Db,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/** The active user for a cookie token, extending the session when it is past half-life. */
export async function resolveSession(
  db: Db,
  token: string,
  now: Date,
): Promise<{ user: AuthUser; expiresAt: Date; renewed: boolean } | null> {
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= now || !session.user.active) return null;
  let { expiresAt } = session;
  const renewed = expiresAt.getTime() - now.getTime() < SESSION_TTL_MS / 2;
  if (renewed) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.session.update({ where: { id: session.id }, data: { expiresAt } });
  }
  const { id, email, name, role } = session.user;
  return { user: { id, email, name, role }, expiresAt, renewed };
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashToken(token) } });
}

/** Removes expired sessions; called on login so the table doesn't grow forever. */
export async function pruneSessions(db: Db, now: Date): Promise<void> {
  await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
}

export function readSessionToken(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join('=')) || null;
  }
  return null;
}

export function setSessionCookie(res: Response, token: string, expires: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}
