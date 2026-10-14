import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Applies pending migrations to the test database once per `npm test` run
 * (non-destructive; tests truncate their own tables).
 */
export default function setup(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example).');
  // Tests TRUNCATE every table: refuse anything that is not clearly a test database.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a database whose name ends with "_test".');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
