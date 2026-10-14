import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { parseTargets, recordError, runChecks } from '../src/modules/logs/uptime-checks.js';
import { db, resetData, setNow, signedIn } from './helpers.js';

const server = http.createServer((req, res) => {
  res.statusCode = req.headers.host === 'fap.test' ? 200 : 400;
  res.end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  server.close();
  await db.$disconnect();
});

describe('uptime and logs', () => {
  it('parses targets', () => {
    expect(parseTargets('API|http://api:3000/health, Site|http://web:4000/login|fap.ro')).toEqual([
      { name: 'API', url: 'http://api:3000/health' },
      { name: 'Site', url: 'http://web:4000/login', host: 'fap.ro' },
    ]);
    expect(() => parseTargets('API')).toThrow();
  });

  it('records checks and shows uptime, incidents and errors to admins only', async () => {
    const now = new Date(2026, 9, 14, 19, 45);
    setNow(now);
    const targets = parseTargets(`Site|${base}/|fap.test,Wrong host|${base}/`);
    for (let i = 3; i >= 0; i--) await runChecks(db, targets, new Date(now.getTime() - i * 60_000));
    await recordError(db, 'api', 'boom', 'GET /api/x');

    await (await signedIn('reception')).get('/api/logs').expect(403);
    const res = await (await signedIn('admin')).get('/api/logs').expect(200);
    const site = res.body.targets.find((t: { name: string }) => t.name === 'Site');
    const wrong = res.body.targets.find((t: { name: string }) => t.name === 'Wrong host');
    expect(site).toMatchObject({ up: true, uptime24h: 100, uptime7d: 100 });
    expect(wrong).toMatchObject({ up: false, uptime24h: 0, lastError: 'HTTP 400' });
    expect(res.body.incidents).toEqual([
      expect.objectContaining({ target: 'Wrong host', checks: 4, error: 'HTTP 400' }),
    ]);
    expect(res.body.errors).toEqual([
      expect.objectContaining({ source: 'api', message: 'boom', path: 'GET /api/x' }),
    ]);
  });
});
