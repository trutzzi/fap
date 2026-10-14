import type { Db } from './db.js';
import type { Clock } from './lib/clock.js';

/** Dependencies passed to every router; swapped in tests. */
export interface Deps {
  db: Db;
  clock: Clock;
}
