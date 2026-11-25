import type { Logger } from 'pino';
import { fromDbDate, toDbDate } from '../../db.js';
import type { Deps } from '../../deps.js';
import { INACTIVITY_NUDGE_DAYS } from '../../contract/models.js';
import {
  EXPIRY_REMINDER_DAYS,
  expiryReminderText,
  inactivityNudgeText,
  smsRecipient,
} from '../../domain/member-access.js';
import { addDays, daysBetween, formatDate, toIsoDate } from '../../lib/dates.js';
import { loadClub } from '../club/club.routes.js';
import { loadSummaries } from '../members/member-queries.js';
import { recordError } from '../logs/uptime-checks.js';
import { notifyMembers, sendSms } from '../notifications/notify.js';

/** Reminders only go out in the daytime (club timezone). */
const SEND_FROM_HOUR = 10;
const SEND_UNTIL_HOUR = 20;
const RUN_EVERY_MS = 15 * 60_000;

/**
 * Texts members whose subscription ends within `EXPIRY_REMINDER_DAYS` days (so a server
 * that was down on the day still catches up), once per subscription period: the period's
 * end date is claimed in `subscriptions.expiry_reminder_for` before sending, so a failed
 * SMS is logged and not retried (no repeated texts if the provider half-works).
 */
export async function sendExpiryReminders({
  db,
  sms,
  push,
  clock,
  publicUrl,
}: Pick<Deps, 'db' | 'sms' | 'push' | 'clock' | 'publicUrl'>): Promise<{
  sent: number;
  failed: number;
}> {
  const result = { sent: 0, failed: 0 };
  const club = await loadClub(db);
  const now = clock();
  if (!club.expiryReminderSms) return result;
  if (now.getHours() < SEND_FROM_HOUR || now.getHours() >= SEND_UNTIL_HOUR) return result;

  const today = toIsoDate(now);
  const due = await db.subscription.findMany({
    where: {
      endDate: { gte: toDbDate(today), lte: toDbDate(addDays(today, EXPIRY_REMINDER_DAYS)) },
    },
    select: {
      memberId: true,
      endDate: true,
      expiryReminderFor: true,
      member: { select: { phone: true } },
    },
  });
  for (const sub of due) {
    if (sub.expiryReminderFor?.getTime() === sub.endDate.getTime()) continue;
    const claimed = await db.$executeRaw`
      UPDATE subscriptions SET expiry_reminder_for = end_date
      WHERE member_id = ${sub.memberId} AND end_date = ${sub.endDate}
        AND expiry_reminder_for IS DISTINCT FROM end_date`;
    if (claimed !== 1) continue;
    const endDate = fromDbDate(sub.endDate);
    const { ok, error } = await sendSms(
      { db, sms, clock },
      {
        memberId: sub.memberId,
        to: smsRecipient(sub.member.phone),
        kind: 'reminder',
        text: expiryReminderText(club.name, endDate, `${publicUrl}/cont`),
      },
    );
    if (ok) result.sent++;
    else {
      result.failed++;
      await recordError(db, 'sms', error ?? 'SMS failed');
    }
    // The app gets it too, even when the SMS failed.
    await notifyMembers({ db, push, clock }, [sub.memberId], {
      kind: 'reminder',
      title: 'Abonamentul expiră curând',
      body: `Abonamentul tău expiră pe ${formatDate(endDate)}. Reînnoiește-l la recepție.`,
    });
  }
  return result;
}

/**
 * "Ne e dor de tine": members with a usable subscription (active or expiring, not frozen)
 * and no check-in for `INACTIVITY_NUDGE_DAYS` days get one notification per absence (and
 * an SMS when switched on). The absence is identified by its last check-in date, or the
 * subscription start for someone who never came, claimed before sending.
 */
export async function sendInactivityNudges({
  db,
  sms,
  push,
  clock,
  publicUrl,
}: Pick<Deps, 'db' | 'sms' | 'push' | 'clock' | 'publicUrl'>): Promise<{
  nudged: number;
  smsFailed: number;
}> {
  const result = { nudged: 0, smsFailed: 0 };
  const club = await loadClub(db);
  const now = clock();
  if (!club.inactivityNudge) return result;
  if (now.getHours() < SEND_FROM_HOUR || now.getHours() >= SEND_UNTIL_HOUR) return result;

  const today = toIsoDate(now);
  const members = (await loadSummaries(db, today)).filter(
    (m) => (m.status === 'active' || m.status === 'expiring') && m.subscription!.startDate <= today,
  );
  if (members.length === 0) return result;
  const ids = members.map((m) => m.id);
  const [last, frozen] = await Promise.all([
    db.checkIn.groupBy({
      by: ['memberId'],
      where: { memberId: { in: ids } },
      _max: { date: true },
    }),
    db.subscriptionFreeze.findMany({
      where: {
        memberId: { in: ids },
        from: { lte: toDbDate(today) },
        to: { gte: toDbDate(today) },
      },
      select: { memberId: true },
    }),
  ]);
  const lastBy = new Map(
    last.map((r) => [r.memberId, r._max.date ? fromDbDate(r._max.date) : null]),
  );
  const frozenIds = new Set(frozen.map((f) => f.memberId));

  for (const m of members) {
    if (frozenIds.has(m.id)) continue;
    const since = lastBy.get(m.id) ?? m.subscription!.startDate;
    if (daysBetween(since, today) < INACTIVITY_NUDGE_DAYS) continue;
    const claimed = await db.$executeRaw`
      UPDATE members SET inactivity_nudge_for = ${toDbDate(since)}
      WHERE id = ${m.id} AND inactivity_nudge_for IS DISTINCT FROM ${toDbDate(since)}`;
    if (claimed !== 1) continue;
    result.nudged++;
    await notifyMembers({ db, push, clock }, [m.id], {
      kind: 'reminder',
      title: 'Ne e dor de tine!',
      body: `N-ai mai fost la antrenament de ${daysBetween(since, today)} de zile. Te așteptăm!`,
    });
    if (club.inactivityNudgeSms) {
      const { ok, error } = await sendSms(
        { db, sms, clock },
        {
          memberId: m.id,
          to: smsRecipient(m.phone),
          kind: 'nudge',
          text: inactivityNudgeText(club.name, daysBetween(since, today), `${publicUrl}/cont`),
        },
      );
      if (!ok) {
        result.smsFailed++;
        await recordError(db, 'sms', error ?? 'SMS failed');
      }
    }
  }
  return result;
}

/** Runs the reminders every 15 minutes in the API process; returns a stop function. */
export function startExpiryReminders(
  deps: Pick<Deps, 'db' | 'sms' | 'push' | 'clock' | 'publicUrl'>,
  logger: Pick<Logger, 'info' | 'error'>,
): () => void {
  const run = () =>
    sendExpiryReminders(deps)
      .then(({ sent, failed }) => {
        if (sent || failed) logger.info(`Expiry reminders: ${sent} sent, ${failed} failed`);
      })
      .then(() => sendInactivityNudges(deps))
      .then(({ nudged }) => {
        if (nudged) logger.info(`Inactivity nudges: ${nudged}`);
      })
      .catch((err: unknown) => logger.error(err));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, RUN_EVERY_MS);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
