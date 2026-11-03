import { randomBytes } from 'node:crypto';
import type { Db } from '../../db.js';
import { hashToken } from '../auth/sessions.js';

export const MEMBER_SESSION_COOKIE = 'fa_member';
/** Members open the portal only to show their QR code: keep them signed in for 90 days. */
const MEMBER_SESSION_TTL_MS = 90 * 24 * 3_600_000;

export async function createMemberSession(
  db: Db,
  memberId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_MS);
  await db.memberSession.create({ data: { id: hashToken(token), memberId, expiresAt } });
  return { token, expiresAt };
}

/** The member of a cookie token, extending the session when it is past half-life. */
export async function resolveMemberSession(
  db: Db,
  token: string,
  now: Date,
): Promise<{ memberId: string; sessionId: string; expiresAt: Date; renewed: boolean } | null> {
  const session = await db.memberSession.findUnique({ where: { id: hashToken(token) } });
  if (!session || session.expiresAt <= now) return null;
  let { expiresAt } = session;
  const renewed = expiresAt.getTime() - now.getTime() < MEMBER_SESSION_TTL_MS / 2;
  if (renewed) {
    expiresAt = new Date(now.getTime() + MEMBER_SESSION_TTL_MS);
    await db.memberSession.update({ where: { id: session.id }, data: { expiresAt } });
  }
  return { memberId: session.memberId, sessionId: session.id, expiresAt, renewed };
}

export async function deleteMemberSession(db: Db, token: string): Promise<void> {
  await db.memberSession.deleteMany({ where: { id: hashToken(token) } });
}

export async function pruneMemberSessions(db: Db, now: Date): Promise<void> {
  await db.memberSession.deleteMany({ where: { expiresAt: { lte: now } } });
}
