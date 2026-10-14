import { Router } from 'express';
import type { StaffRef } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { requireAdmin } from '../auth/auth.middleware.js';

/** `GET /users/coaches`: active coach accounts, for linking a course to its coach (admin). */
export function usersRouter({ db }: Deps): Router {
  const router = Router();

  router.get('/coaches', requireAdmin, async (_req, res) => {
    const coaches: StaffRef[] = await db.user.findMany({
      where: { role: 'coach', active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(coaches);
  });

  return router;
}
