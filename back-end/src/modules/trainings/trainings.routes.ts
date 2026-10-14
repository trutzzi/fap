import { Router } from 'express';
import type { Deps } from '../../deps.js';
import { trainingsToday } from './trainings-today.js';

/** `GET /trainings/today`: coaches get their own courses only; staff get everything. */
export function trainingsRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/today', async (req, res) => {
    const coachUserId = req.user?.role === 'coach' ? req.user.id : undefined;
    res.json(await trainingsToday(db, clock(), { coachUserId }));
  });

  return router;
}
