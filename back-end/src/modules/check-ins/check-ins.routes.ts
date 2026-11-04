import { Router } from 'express';
import type { CheckInOutcome, CheckInResult, KioskStatus } from '../../contract/models.js';
import { toDbDate } from '../../db.js';
import type { RefusalReason } from '../../generated/prisma/client.js';
import type { Deps } from '../../deps.js';
import { parseQrToken, verifyQrToken } from '../../domain/member-access.js';
import { normalizeRfid } from '../../domain/membership.js';
import { currentSlot } from '../../domain/schedule.js';
import { formatDate, isoWeekday, toIsoDate } from '../../lib/dates.js';
import { notFound } from '../../lib/http-error.js';
import { checkInSchema, parse } from '../../lib/validation.js';
import { loadSummary } from '../members/member-queries.js';
import { notifyMembers, type NotificationInput } from '../notifications/notify.js';

/** Without a matching training, a repeat check-in within this window counts as a duplicate. */
const DUPLICATE_WINDOW_MS = 2 * 3_600_000;

/** Kiosk status and check-in (card scan, member QR code, or manual at reception). */
export function checkInsRouter({ db, clock, push }: Deps): Router {
  const router = Router();

  const todaysSlots = (now: Date) =>
    db.trainingSlot.findMany({
      where: { weekday: isoWeekday(toIsoDate(now)) },
      include: { course: true },
    });

  router.get('/kiosk/status', async (_req, res) => {
    const now = clock();
    const slot = currentSlot(await todaysSlots(now), now);
    const body: KioskStatus = {
      current: slot
        ? {
            slotId: slot.id,
            label: slot.label ?? slot.course.name,
            time: slot.time,
            coach: slot.course.coach,
          }
        : null,
    };
    res.json(body);
  });

  router.post('/checkins', async (req, res) => {
    const input = parse(checkInSchema, req.body);
    const method = input.rfid ? 'rfid' : input.qr ? 'qr' : 'manual';

    if (input.qr) {
      const claimed = parseQrToken(input.qr);
      const owner = claimed
        ? await db.member.findUnique({
            where: { id: claimed.memberId },
            select: { qrSecret: true },
          })
        : null;
      if (!owner?.qrSecret || !verifyQrToken(input.qr, owner.qrSecret, clock())) {
        const body: CheckInResult = { outcome: 'invalid-qr', member: null, trainingLabel: null };
        res.json(body);
        return;
      }
    }
    const memberRow = input.rfid
      ? await db.member.findUnique({
          where: { rfid: normalizeRfid(input.rfid) },
          select: { id: true },
        })
      : await db.member.findUnique({
          where: { id: input.qr ? parseQrToken(input.qr)!.memberId : input.memberId! },
          select: { id: true },
        });
    if (!memberRow) {
      if (!input.rfid) throw notFound('Membrul nu a fost găsit.');
      const body: CheckInResult = { outcome: 'unknown-card', member: null, trainingLabel: null };
      res.json(body);
      return;
    }

    // Serialize check-ins per member so two quick taps can't both pass the session limit.
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${memberRow.id}))`;
      const now = clock();
      const today = toIsoDate(now);
      const member = (await loadSummary(tx, memberRow.id, today))!;
      const courseIds = member.courses.map((c) => c.id);
      const slot = currentSlot(await todaysSlots(now), now, courseIds);
      const trainingLabel = slot ? (slot.label ?? slot.course.name) : null;
      const reply = (outcome: CheckInOutcome): CheckInResult => ({
        outcome,
        member,
        trainingLabel,
      });

      /** Records a refusal for the coach's class list; repeated taps update one row. */
      const refuse = async (reason: RefusalReason, outcome: CheckInOutcome) => {
        const key = { memberId: member.id, date: toDbDate(today), slotId: slot?.id ?? null };
        const previous = await tx.refusedScan.findFirst({ where: key, select: { id: true } });
        await (previous
          ? tx.refusedScan.update({ where: { id: previous.id }, data: { reason, timestamp: now } })
          : tx.refusedScan.create({ data: { ...key, trainingLabel, reason, timestamp: now } }));
        return reply(outcome);
      };

      if (member.status === 'none' || member.subscription!.startDate > today)
        return refuse('no_subscription', 'no-subscription');
      if (member.status === 'expired') return refuse('expired', 'expired');

      const duplicate = await tx.checkIn.count({
        where: slot
          ? { memberId: member.id, date: toDbDate(today), slotId: slot.id }
          : {
              memberId: member.id,
              timestamp: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
            },
      });
      if (duplicate > 0) return reply('already-checked-in');
      if (member.status === 'limit') return refuse('limit', 'limit');

      await tx.checkIn.create({
        data: {
          memberId: member.id,
          slotId: slot?.id ?? null,
          trainingLabel,
          date: toDbDate(today),
          timestamp: now,
          method,
        },
      });
      return { ...reply('allowed'), member: (await loadSummary(tx, member.id, today))! };
    });
    const notification = checkInNotification(result);
    if (notification) await notifyMembers({ db, push, clock }, [result.member!.id], notification);
    res.json(result);
  });

  return router;
}

/** What the member's phone shows after a scan; nothing for repeats and unknown cards. */
function checkInNotification(result: CheckInResult): NotificationInput | null {
  const sub = result.member?.subscription ?? null;
  const training = result.trainingLabel ?? 'Acces liber';
  switch (result.outcome) {
    case 'allowed':
      return {
        kind: 'checkin',
        title: 'Check-in confirmat',
        body:
          sub?.sessionLimit != null
            ? `${training} · ședința ${sub.used} din ${sub.sessionLimit}`
            : `${training} · abonament nelimitat`,
      };
    case 'limit':
      return {
        kind: 'refused',
        title: 'Check-in refuzat',
        body: 'Ai folosit toate ședințele din abonament. Reînnoiește-l la recepție.',
      };
    case 'expired':
      return {
        kind: 'refused',
        title: 'Check-in refuzat',
        body: `Abonamentul a expirat${sub ? ` pe ${formatDate(sub.endDate)}` : ''}. Reînnoiește-l la recepție.`,
      };
    case 'no-subscription':
      return {
        kind: 'refused',
        title: 'Check-in refuzat',
        body: 'Nu ai un abonament activ. Te rugăm să mergi la recepție.',
      };
    default:
      return null;
  }
}
