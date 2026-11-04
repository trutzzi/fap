import webpush from 'web-push';
import type { Db } from '../db.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends Web Push messages. `gone` means the browser dropped the subscription (the app was
 * uninstalled or notifications were turned off): delete it.
 */
export interface PushSender {
  /** The VAPID public key browsers subscribe with; `null` when push is off. */
  publicKey: string | null;
  send(target: PushTarget, payload: string): Promise<'ok' | 'gone' | 'failed'>;
}

export function webPushSender(
  keys: { publicKey: string; privateKey: string },
  subject: string,
): PushSender {
  return {
    publicKey: keys.publicKey,
    async send(target, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
          { vapidDetails: { subject, ...keys }, TTL: 6 * 3600 },
        );
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'failed';
      }
    },
  };
}

/** The server's VAPID key pair, generated on first start and kept in `app_settings`. */
export async function loadVapidKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  const rows = await db.appSetting.findMany({
    where: { key: { in: ['vapid_public_key', 'vapid_private_key'] } },
  });
  const get = (key: string) => rows.find((r) => r.key === key)?.value;
  const publicKey = get('vapid_public_key');
  const privateKey = get('vapid_private_key');
  if (publicKey && privateKey) return { publicKey, privateKey };
  const keys = webpush.generateVAPIDKeys();
  await db.$transaction([
    db.appSetting.upsert({
      where: { key: 'vapid_public_key' },
      create: { key: 'vapid_public_key', value: keys.publicKey },
      update: { value: keys.publicKey },
    }),
    db.appSetting.upsert({
      where: { key: 'vapid_private_key' },
      create: { key: 'vapid_private_key', value: keys.privateKey },
      update: { value: keys.privateKey },
    }),
  ]);
  return keys;
}
