import { Router } from 'express';
import type { StaffAccount, StaffRef } from '../../contract/models.js';
import type { Deps } from '../../deps.js';
import { hashPassword } from '../../lib/password.js';
import { notFound } from '../../lib/http-error.js';
import { parse, setPasswordSchema } from '../../lib/validation.js';
import { requireAdmin } from '../auth/auth.middleware.js';
import { hashToken, readSessionToken } from '../auth/sessions.js';

/**
 * Staff accounts (admin only): the coach picker, the account list of Administrare › Conturi
 * and setting a password. Accounts are still created on the server (`npm run user:create`).
 */
export function usersRouter({ db }: Deps): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const users = await db.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const body: StaffAccount[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    }));
    res.json(body);
  });

  /** `GET /users/coaches`: active coach accounts, for linking a course to its coach. */
  router.get('/coaches', async (_req, res) => {
    const coaches: StaffRef[] = await db.user.findMany({
      where: { role: 'coach', active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(coaches);
  });

  /** Sets a password and signs that account out everywhere (except this admin's session). */
  router.put('/:id/password', async (req, res) => {
    const { password } = parse(setPasswordSchema, req.body);
    const user = await db.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!user) throw notFound('Contul nu a fost găsit.');
    const current = hashToken(readSessionToken(req) ?? '');
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      }),
      db.session.deleteMany({ where: { userId: user.id, id: { not: current } } }),
    ]);
    res.status(204).end();
  });

  return router;
}
