import { existsSync } from 'node:fs';
import { pino } from 'pino';
import { createDb } from './db.js';
import { parseTargets, pruneOld, recordError, runChecks } from './modules/logs/uptime-checks.js';

/**
 * Uptime worker, run as its own container next to the API: probes each target every
 * `UPTIME_INTERVAL_SECONDS` and stores the results for the admin logs page.
 */
if (existsSync('.env')) process.loadEnvFile('.env');
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const targets = parseTargets(process.env['UPTIME_TARGETS'] ?? 'API|http://localhost:3000/health');
const intervalMs = Number(process.env['UPTIME_INTERVAL_SECONDS'] ?? 60) * 1000;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const db = createDb(databaseUrl);
const lastState = new Map<string, boolean>();
let lastPrune = 0;

async function tick() {
  try {
    for (const { t, r } of await runChecks(db, targets)) {
      if (lastState.get(t.name) !== r.ok) {
        const log = r.ok ? logger.info.bind(logger) : logger.warn.bind(logger);
        log({ target: t.name, status: r.status, error: r.error }, r.ok ? 'up' : 'down');
      }
      lastState.set(t.name, r.ok);
    }
    if (Date.now() - lastPrune > 86_400_000) {
      await pruneOld(db);
      lastPrune = Date.now();
    }
  } catch (err) {
    logger.error(err);
    await recordError(db, 'uptime', err instanceof Error ? err.message : String(err));
  }
}

logger.info({ targets: targets.map((t) => t.name), intervalMs }, 'uptime worker started');
await tick();
const timer = setInterval(() => void tick(), intervalMs);

async function shutdown() {
  clearInterval(timer);
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
