import { Router, type RequestHandler } from 'express';
import type { MemberAccount, MemberQrCode } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { newQrSecret, phoneKey, QR_STEP_MS, qrToken } from '../../domain/member-access.js';
import { today } from '../../lib/clock.js';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { memberLoginSchema, parse, pinChangeSchema } from '../../lib/validation.js';
import { clearSessionCookie, readSessionToken, setSessionCookie } from '../auth/sessions.js';
import { checkInHistory, loadSummary } from '../members/member-queries.js';
import { membersWithPhone, pinTakenOnPhone } from './member-access.js';
import {
  MEMBER_SESSION_COOKIE,
  createMemberSession,
  deleteMemberSession,
  pruneMemberSessions,
  resolveMemberSession,
} from './member-sessions.js';

const LOGIN_WINDOW_MS = 15 * 60_000;
/** PINs are short: few guesses per phone number. */
const MAX_FAILURES_PER_PHONE = 5;
/** The whole gym may sign in from the club's Wi-Fi, behind one address. */
const MAX_FAILURES_PER_IP = 100;
const HISTORY_SIZE = 10;

const NOT_SIGNED_IN = 'Autentifică-te pentru a continua.';

/**
 * Member portal: members sign in with their phone number and the PIN they received by
 * SMS, then show their rotating QR code at the kiosk. Separate from staff auth: its own
 * cookie and sessions table, and a member session never grants access to the staff API.
 */
export function accountRouter({ db, clock }: Deps): Router {
  const router = Router();
  const byPhone = new RateLimiter(MAX_FAILURES_PER_PHONE, LOGIN_WINDOW_MS);
  const byIp = new RateLimiter(MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS);

  router.post('/login', async (req, res) => {
    const { phone, pin } = parse(memberLoginSchema, req.body);
    const key = phoneKey(phone);
    const checks = [
      [byPhone, key],
      [byIp, req.ip ?? 'unknown'],
    ] as const;
    const blocked = checks.find(([limiter, k]) => limiter.isBlocked(k));
    if (blocked) {
      res.setHeader('Retry-After', String(blocked[0].retryAfter(blocked[1])));
      throw new HttpError(429, 'Prea multe încercări eșuate. Încearcă din nou în câteva minute.');
    }

    // Phone numbers are not unique (siblings share a parent's phone): the PIN decides
    // which member signs in (PINs are kept unique per phone).
    const candidates = await membersWithPhone(db, phone);
    let memberId: string | null = null;
    for (const candidate of candidates) {
      if (await verifyPassword(pin, candidate.passwordHash)) {
        memberId = candidate.id;
        break;
      }
    }
    if (!candidates.length) await verifyAgainstDummy(pin);
    if (!memberId) {
      checks.forEach(([limiter, k]) => limiter.record(k));
      throw new HttpError(401, 'Număr de telefon sau PIN greșit.');
    }

    byPhone.reset(key);
    const now = clock();
    await pruneMemberSessions(db, now);
    const { token, expiresAt } = await createMemberSession(db, memberId, now);
    setSessionCookie(res, token, expiresAt, MEMBER_SESSION_COOKIE);
    res.json(await account(memberId));
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req, MEMBER_SESSION_COOKIE);
    if (token) await deleteMemberSession(db, token);
    clearSessionCookie(res, MEMBER_SESSION_COOKIE);
    res.status(204).end();
  });

  /** Everything below needs a member session. */
  const requireMember: RequestHandler = async (req, res, next) => {
    const token = readSessionToken(req, MEMBER_SESSION_COOKIE);
    const session = token ? await resolveMemberSession(db, token, clock()) : null;
    if (!session) return next(new HttpError(401, NOT_SIGNED_IN));
    if (session.renewed) setSessionCookie(res, token!, session.expiresAt, MEMBER_SESSION_COOKIE);
    req.member = { id: session.memberId, sessionId: session.sessionId };
    next();
  };
  router.use(requireMember);

  async function account(memberId: string): Promise<MemberAccount> {
    const summary = await loadSummary(db, memberId, today(clock));
    if (!summary) throw new HttpError(401, NOT_SIGNED_IN);
    const { id, firstName, fullName, initials, phone, courses, subscription, status } = summary;
    return {
      id,
      firstName,
      fullName,
      initials,
      phone,
      courses,
      subscription,
      status,
      history: await checkInHistory(db, summary, HISTORY_SIZE),
    };
  }

  router.get('/', async (req, res) => {
    res.json(await account(req.member!.id));
  });

  router.get('/qr', async (req, res) => {
    const memberId = req.member!.id;
    const row = await db.member.findUniqueOrThrow({
      where: { id: memberId },
      select: { qrSecret: true },
    });
    let secret = row.qrSecret;
    if (!secret) {
      secret = newQrSecret();
      await db.member.update({ where: { id: memberId }, data: { qrSecret: secret } });
    }
    const { token, expiresAt } = qrToken(memberId, secret, clock());
    const body: MemberQrCode = {
      token,
      expiresAt: expiresAt.toISOString(),
      refreshSeconds: QR_STEP_MS / 1000,
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.put('/pin', async (req, res) => {
    const { currentPin, newPin } = parse(pinChangeSchema, req.body);
    const { id, sessionId } = req.member!;
    const row = await db.member.findUniqueOrThrow({
      where: { id },
      select: { passwordHash: true, phone: true },
    });
    if (!row.passwordHash || !(await verifyPassword(currentPin, row.passwordHash))) {
      throw new HttpError(400, 'PIN-ul actual este greșit.');
    }
    if (await pinTakenOnPhone(db, row.phone, newPin, id)) {
      throw new HttpError(400, 'Acest PIN nu poate fi folosit. Alege altul.');
    }
    // Other devices are signed out; this one stays signed in.
    await db.member.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(newPin),
        sessions: { deleteMany: { id: { not: sessionId } } },
      },
    });
    res.status(204).end();
  });

  return router;
}
