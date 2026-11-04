import { Router } from 'express';
import type { SmsCredit } from '../../contract/models.js';
import type { Deps } from '../../deps.js';

/** SMSLink is asked at most once a minute (the pages show it often). */
const CACHE_MS = 60_000;

/** `GET /sms/credit` for staff: the SMS left in the SMSLink account. */
export function smsRouter({ sms }: Deps): Router {
  const router = Router();
  let cached: { at: number; body: SmsCredit } | null = null;

  router.get('/sms/credit', async (_req, res) => {
    if (!cached || Date.now() - cached.at > CACHE_MS) {
      let body: SmsCredit;
      try {
        const credit = await sms.credit();
        body = { configured: credit !== null, credit, error: null };
      } catch (err) {
        body = {
          configured: true,
          credit: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      cached = { at: Date.now(), body };
    }
    res.json(cached.body);
  });

  return router;
}
