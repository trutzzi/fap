import type { Db } from './db.js';
import type { Clock } from './lib/clock.js';
import type { PushSender } from './lib/push.js';
import type { SmsSender } from './lib/sms.js';

/** Dependencies passed to every router; swapped in tests. */
export interface Deps {
  db: Db;
  clock: Clock;
  sms: SmsSender;
  push: PushSender;
  /** Public address of the app without a trailing slash, e.g. `https://fap.valentintruta.ro`. */
  publicUrl: string;
}
