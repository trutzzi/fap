import { existsSync } from 'node:fs';
import { pino } from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { systemClock } from './lib/clock.js';
import { logSmsSender, smsLinkSender } from './lib/sms.js';
import { DEFAULT_CLUB, applyTimezone, loadClub } from './modules/club/club.routes.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();

// All date logic runs in the club's timezone (APP_TIMEZONE until the admin sets one).
process.env['TZ'] = config.APP_TIMEZONE;

const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
});
const db = createDb(config.DATABASE_URL);
applyTimezone(await loadClub(db, { ...DEFAULT_CLUB, timezone: config.APP_TIMEZONE }));
const sms =
  config.SMSLINK_CONNECTION_ID && config.SMSLINK_PASSWORD
    ? smsLinkSender({
        connectionId: config.SMSLINK_CONNECTION_ID,
        password: config.SMSLINK_PASSWORD,
        sender: config.SMSLINK_SENDER,
        test: config.SMSLINK_TEST,
      })
    : logSmsSender(logger);
if (config.NODE_ENV === 'production' && !config.SMSLINK_CONNECTION_ID) {
  logger.warn('SMSLINK_* is not set: member passwords are shown to reception instead of texted');
}
const app = createApp({
  db,
  clock: systemClock,
  sms,
  publicUrl: config.PUBLIC_URL,
  logger,
  trustProxy: config.TRUST_PROXY,
});

const server = app.listen(config.PORT, (error) => {
  if (error) throw error;
  logger.info(`FightAcademy API listening on http://localhost:${config.PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
