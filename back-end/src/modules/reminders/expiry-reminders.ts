import type { Logger } from 'pino';
import { fromDbDate, toDbDate } from '../../db.js';
import type { Deps } from '../../deps.js';
import {
  EXPIRY_REMINDER_DAYS,
  expiryReminderText,
  smsRecipient,
} from '../../domain/member-access.js';
import { addDays, toIsoDate } from '../../lib/dates.js';
import { loadClub } from '../club/club.routes.js';
import { recordError } from '../logs/uptime-checks.js';

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
  clock,
}: Pick<Deps, 'db' | 'sms' | 'clock'>): Promise<{ sent: number; failed: number }> {
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
    try {
      const text = expiryReminderText(club.name, fromDbDate(sub.endDate));
      if (await sms.send(smsRecipient(sub.member.phone), text)) result.sent++;
      else
        throw new Error(
          'Expiry reminders are on, but SMSLINK_CONNECTION_ID / SMSLINK_PASSWORD are not set',
        );
    } catch (err) {
      result.failed++;
      await recordError(db, 'sms', err instanceof Error ? err.message : String(err));
    }
  }
  return result;
}

/** Runs the reminders every 15 minutes in the API process; returns a stop function. */
export function startExpiryReminders(
  deps: Pick<Deps, 'db' | 'sms' | 'clock'>,
  logger: Pick<Logger, 'info' | 'error'>,
): () => void {
  const run = () =>
    sendExpiryReminders(deps)
      .then(({ sent, failed }) => {
        if (sent || failed) logger.info(`Expiry reminders: ${sent} sent, ${failed} failed`);
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
