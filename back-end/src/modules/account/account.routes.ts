import { Router, type RequestHandler } from 'express';
import type {
  MemberAccount,
  MemberAnnouncement,
  MemberNotification,
  MemberNotificationKind,
  MemberQrCode,
  PushConfig,
} from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { newQrSecret, phoneKey, QR_STEP_MS, qrToken } from '../../domain/member-access.js';
import { memberStats, type StatsCheckIn } from '../../domain/member-stats.js';
import { fromDbDate } from '../../db.js';
import { today } from '../../lib/clock.js';
import { HttpError } from '../../lib/http-error.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import {
  memberLoginSchema,
  parse,
  pinChangeSchema,
  pushSubscriptionSchema,
} from '../../lib/validation.js';
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
export function accountRouter({ db, clock, push }: Deps): Router {
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
      unreadAnnouncements: await db.announcementRecipient.count({
        where: { memberId, readAt: null },
      }),
      unreadNotifications: await db.memberNotification.count({
        where: { memberId, readAt: null },
      }),
      joinedAt: summary.joinedAt,
      stats: memberStats(await statsCheckIns(memberId), today(clock)),
    };
  }

  async function statsCheckIns(memberId: string): Promise<StatsCheckIn[]> {
    const rows = await db.checkIn.findMany({
      where: { memberId },
      select: { date: true, trainingLabel: true, slot: { select: { durationMin: true } } },
    });
    return rows.map((r) => ({
      date: fromDbDate(r.date),
      trainingLabel: r.trainingLabel,
      durationMin: r.slot?.durationMin ?? null,
    }));
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

  /** The member's announcements, newest first (the last 50). */
  router.get('/announcements', async (req, res) => {
    const rows = await db.announcementRecipient.findMany({
      where: { memberId: req.member!.id },
      include: { announcement: true },
      orderBy: { announcement: { createdAt: 'desc' } },
      take: 50,
    });
    const body: MemberAnnouncement[] = rows.map(({ announcement: a, readAt }) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.createdAt.toISOString(),
      read: readAt !== null,
    }));
    res.json(body);
  });

  /** Marks all of the member's announcements as read (they opened the list). */
  router.post('/announcements/read', async (req, res) => {
    await db.announcementRecipient.updateMany({
      where: { memberId: req.member!.id, readAt: null },
      data: { readAt: clock() },
    });
    res.status(204).end();
  });

  /** The member's inbox, newest first (the last 50). */
  router.get('/notifications', async (req, res) => {
    const rows = await db.memberNotification.findMany({
      where: { memberId: req.member!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const body: MemberNotification[] = rows.map((n) => ({
      id: n.id,
      kind: n.kind as MemberNotificationKind,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      read: n.readAt !== null,
    }));
    res.json(body);
  });

  router.post('/notifications/read', async (req, res) => {
    await db.memberNotification.updateMany({
      where: { memberId: req.member!.id, readAt: null },
      data: { readAt: clock() },
    });
    res.status(204).end();
  });

  /** Web Push: the key to subscribe with (`null` when the server has push off). */
  router.get('/push', (_req, res) => {
    const body: PushConfig = { publicKey: push.publicKey };
    res.json(body);
  });

  /** Saves this device's push subscription (re-subscribing moves it to this member). */
  router.post('/push', async (req, res) => {
    const { endpoint, keys } = parse(pushSubscriptionSchema, req.body);
    const data = { memberId: req.member!.id, p256dh: keys.p256dh, auth: keys.auth };
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, ...data },
      update: data,
    });
    res.status(204).end();
  });

  router.delete('/push', async (req, res) => {
    const endpoint = String((req.query['endpoint'] as string | undefined) ?? '');
    await db.pushSubscription.deleteMany({ where: { endpoint, memberId: req.member!.id } });
    res.status(204).end();
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
