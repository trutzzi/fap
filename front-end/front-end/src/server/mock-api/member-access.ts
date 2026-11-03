import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { MEMBER_QR_PREFIX } from '../../app/core/api/models';

/**
 * Member portal rules, as in the back-end's `src/domain/member-access.ts`: phone matching,
 * generated PINs and the rotating, signed check-in QR code.
 */

/** Digits only; Romanian numbers in national form (`+40 722…` → `0722…`). */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0040')) return `0${digits.slice(4)}`;
  if (digits.startsWith('40') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('7') && digits.length === 9) return `0${digits}`;
  return digits;
}

/** Generated PINs have 6 digits; members may choose 4–6 digits. */
export const PIN_PATTERN = /^\d{4,6}$/;

export function generateMemberPin(): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

export const QR_STEP_MS = 30_000;
const QR_GRACE_STEPS = 2;

export function newQrSecret(): string {
  return randomBytes(32).toString('base64url');
}

const sign = (secret: string, memberId: string, step: number) =>
  createHmac('sha256', secret).update(`${memberId}.${step}`).digest('hex').slice(0, 16);

export function qrToken(memberId: string, secret: string, now: Date) {
  const step = Math.floor(now.getTime() / QR_STEP_MS);
  return {
    token: `${MEMBER_QR_PREFIX}${memberId}.${step.toString(36)}.${sign(secret, memberId, step)}`,
    expiresAt: new Date((step + QR_GRACE_STEPS + 1) * QR_STEP_MS),
  };
}

/** The member id a token claims, if it is well formed. */
export function qrMemberId(token: string): string | null {
  if (!token.startsWith(MEMBER_QR_PREFIX)) return null;
  const [memberId, step, signature] = token.slice(MEMBER_QR_PREFIX.length).split('.');
  return memberId && step && signature?.length === 16 ? memberId : null;
}

export function verifyQrToken(token: string, secret: string, now: Date): boolean {
  const [memberId, step36, signature] = token.slice(MEMBER_QR_PREFIX.length).split('.');
  if (!qrMemberId(token) || !/^[0-9a-z]+$/.test(step36) || !/^[0-9a-f]{16}$/.test(signature)) {
    return false;
  }
  const step = parseInt(step36, 36);
  const age = Math.floor(now.getTime() / QR_STEP_MS) - step;
  if (age < -1 || age > QR_GRACE_STEPS) return false;
  return timingSafeEqual(Buffer.from(sign(secret, memberId, step)), Buffer.from(signature));
}

const COOKIE = 'fa_member';

/** In-memory member portal sessions (token → member id); reset on server restart. */
export class MockMemberSessions {
  private readonly sessions = new Map<string, string>();

  start(res: Response, memberId: string): void {
    const token = randomBytes(24).toString('base64url');
    this.sessions.set(token, memberId);
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  }

  memberId(req: Request): string | undefined {
    const token = this.token(req);
    return token ? this.sessions.get(token) : undefined;
  }

  end(req: Request, res: Response): void {
    const token = this.token(req);
    if (token) this.sessions.delete(token);
    res.clearCookie(COOKIE, { path: '/' });
  }

  /** Signs a member out everywhere, optionally keeping the current request's session. */
  endAll(memberId: string, keep?: Request): void {
    const kept = keep ? this.token(keep) : undefined;
    for (const [token, id] of this.sessions) {
      if (id === memberId && token !== kept) this.sessions.delete(token);
    }
  }

  private token(req: Request): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [name, ...value] = part.trim().split('=');
      if (name === COOKIE) return value.join('=');
    }
    return undefined;
  }
}
