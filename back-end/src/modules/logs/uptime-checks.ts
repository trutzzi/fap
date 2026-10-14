import http from 'node:http';
import https from 'node:https';
import type { Db } from '../../db.js';

export interface UptimeTargetConfig {
  name: string;
  url: string;
  /** Host header to send (Angular SSR rejects unknown hosts). */
  host?: string;
}

/** Checks and error logs older than this are deleted. */
export const RETENTION_DAYS = 30;
const TIMEOUT_MS = 10_000;

/** `UPTIME_TARGETS`: comma-separated `name|url` or `name|url|host` entries. */
export function parseTargets(value: string): UptimeTargetConfig[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, url, host] = entry.split('|').map((s) => s.trim());
      if (!name || !url) throw new Error(`UPTIME_TARGETS: invalid entry "${entry}"`);
      new URL(url); // throws on a malformed URL
      return host ? { name, url, host } : { name, url };
    });
}

interface ProbeResult {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
}

/** GET the URL; any 2xx/3xx within the timeout counts as up. */
export function probe(target: UptimeTargetConfig): Promise<ProbeResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  return new Promise((resolve) => {
    const url = new URL(target.url);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(
      url,
      { headers: target.host ? { host: target.host } : {}, timeout: TIMEOUT_MS },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 400;
        resolve({ ok, status, latencyMs: elapsed(), error: ok ? null : `HTTP ${status}` });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Fără răspuns în ${TIMEOUT_MS / 1000} s`)));
    req.on('error', (err: NodeJS.ErrnoException) =>
      resolve({ ok: false, status: null, latencyMs: elapsed(), error: err.code ?? err.message }),
    );
  });
}

/** Probes every target once and stores the results. */
export async function runChecks(db: Db, targets: UptimeTargetConfig[], now = new Date()) {
  const results = await Promise.all(targets.map(async (t) => ({ t, r: await probe(t) })));
  await db.uptimeCheck.createMany({
    data: results.map(({ t, r }) => ({
      target: t.name,
      ok: r.ok,
      status: r.status,
      latencyMs: r.latencyMs,
      error: r.error,
      checkedAt: now,
    })),
  });
  return results;
}

export async function pruneOld(db: Db, now = new Date()): Promise<void> {
  const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  await db.uptimeCheck.deleteMany({ where: { checkedAt: { lt: before } } });
  await db.errorLog.deleteMany({ where: { createdAt: { lt: before } } });
}

/** Records an unexpected error; never throws (logging must not break the request). */
export async function recordError(
  db: Db,
  source: string,
  message: string,
  path: string | null = null,
): Promise<void> {
  try {
    await db.errorLog.create({ data: { source, message: message.slice(0, 500), path } });
  } catch {
    // The database itself may be the problem; stdout logs still have the error.
  }
}
