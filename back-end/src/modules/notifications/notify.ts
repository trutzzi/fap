import type { MemberNotificationKind } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import type { SmsKind } from '../../generated/prisma/client.js';

/** Payload the service worker (`public/sw.js`) shows. */
interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface NotificationInput {
  kind: MemberNotificationKind;
  title: string;
  body: string;
}

/**
 * Adds notifications to members' inboxes and pushes them to their devices. The push runs
 * in the background: a slow push service must never slow down a check-in.
 */
export async function notifyMembers(
  deps: Pick<Deps, 'db' | 'push' | 'clock'>,
  memberIds: string[],
  notification: NotificationInput,
): Promise<void> {
  if (memberIds.length === 0) return;
  await deps.db.memberNotification.createMany({
    data: memberIds.map((memberId) => ({ memberId, ...notification, createdAt: deps.clock() })),
  });
  void pushTo(deps, memberIds, {
    title: notification.title,
    body: notification.body,
    url: '/cont',
  });
}

async function pushTo(
  { db, push }: Pick<Deps, 'db' | 'push'>,
  memberIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!push.publicKey) return;
  try {
    const targets = await db.pushSubscription.findMany({ where: { memberId: { in: memberIds } } });
    for (const target of targets) {
      if ((await push.send(target, JSON.stringify(payload))) === 'gone') {
        await db.pushSubscription.deleteMany({ where: { id: target.id } });
      }
    }
  } catch {
    // Push is best effort: the notification is in the inbox anyway.
  }
}

/**
 * Sends one SMS and logs it in `sms_messages` (the staff feed), without the text, which
 * may hold a PIN. Returns whether the provider accepted it, and why not.
 */
export async function sendSms(
  { db, sms, clock }: Pick<Deps, 'db' | 'sms' | 'clock'>,
  message: { memberId: string | null; to: string; kind: SmsKind; text: string },
): Promise<{ ok: boolean; error: string | null }> {
  let ok = false;
  let error: string | null = null;
  try {
    ok = await sms.send(message.to, message.text);
    if (!ok) error = 'SMSLINK_CONNECTION_ID / SMSLINK_PASSWORD are not set';
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await db.smsMessage
    .create({
      data: {
        memberId: message.memberId,
        to: message.to,
        kind: message.kind,
        sent: ok,
        error: error?.slice(0, 300) ?? null,
        createdAt: clock(),
      },
    })
    .catch(() => undefined);
  return { ok, error };
}
