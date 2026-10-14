import { Router } from 'express';
import type { LogsSummary, UptimeIncident, UptimeTarget } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { assertAdmin } from '../auth/auth.middleware.js';

/** Failures closer together than this belong to the same incident. */
const INCIDENT_GAP_MS = 3 * 60_000;
const DAY_MS = 86_400_000;

const percent = (ok: number, total: number) =>
  total ? Math.round((ok / total) * 1000) / 10 : null;

/** Uptime and error logs for the admin "logs" page. */
export function logsRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/logs', async (req, res) => {
    assertAdmin(req);
    const now = clock();
    const since7d = new Date(now.getTime() - 7 * DAY_MS);
    const since24h = new Date(now.getTime() - DAY_MS);

    const [latest, week, day, failures, errors] = await Promise.all([
      db.uptimeCheck.findMany({
        distinct: ['target'],
        orderBy: [{ target: 'asc' }, { checkedAt: 'desc' }],
      }),
      db.uptimeCheck.groupBy({
        by: ['target', 'ok'],
        where: { checkedAt: { gte: since7d } },
        _count: true,
      }),
      db.uptimeCheck.groupBy({
        by: ['target', 'ok'],
        where: { checkedAt: { gte: since24h } },
        _count: true,
      }),
      db.uptimeCheck.findMany({
        where: { ok: false, checkedAt: { gte: since7d } },
        orderBy: { checkedAt: 'asc' },
      }),
      db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);

    const share = (rows: typeof week, target: string) => {
      const ok = rows.find((r) => r.target === target && r.ok)?._count ?? 0;
      const failed = rows.find((r) => r.target === target && !r.ok)?._count ?? 0;
      return percent(ok, ok + failed);
    };
    const targets: UptimeTarget[] = latest.map((c) => ({
      name: c.target,
      up: c.ok,
      lastCheckedAt: c.checkedAt.toISOString(),
      latencyMs: c.latencyMs,
      lastError: c.error,
      uptime24h: share(day, c.target),
      uptime7d: share(week, c.target),
    }));

    const incidents: UptimeIncident[] = [];
    const open = new Map<string, UptimeIncident>();
    for (const f of failures) {
      const current = open.get(f.target);
      if (current && f.checkedAt.getTime() - Date.parse(current.to) <= INCIDENT_GAP_MS) {
        current.to = f.checkedAt.toISOString();
        current.checks++;
      } else {
        const incident = {
          target: f.target,
          from: f.checkedAt.toISOString(),
          to: f.checkedAt.toISOString(),
          checks: 1,
          error: f.error,
        };
        incidents.push(incident);
        open.set(f.target, incident);
      }
    }

    const body: LogsSummary = {
      targets,
      incidents: incidents.reverse().slice(0, 30),
      errors: errors.map((e) => ({
        id: e.id,
        createdAt: e.createdAt.toISOString(),
        source: e.source,
        message: e.message,
        path: e.path,
      })),
    };
    res.json(body);
  });

  return router;
}
