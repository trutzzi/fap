import { Router } from 'express';
import type { StaffAccount, StaffRef } from '../../contract/models.js';
import type { User } from '../../generated/prisma/client.js';
import type { Deps } from '../../deps.js';
import { hashPassword } from '../../lib/password.js';
import { conflict, notFound } from '../../lib/http-error.js';
import { newStaffAccountSchema, parse, setPasswordSchema } from '../../lib/validation.js';
import { requireAdmin } from '../auth/auth.middleware.js';
import { hashToken, readSessionToken } from '../auth/sessions.js';

/**
 * Staff accounts (admin only): the coach picker, and Administrare › Conturi (list, create,
 * set a password). `npm run user:*` does the same from the server's command line.
 */
export function usersRouter({ db }: Deps): Router {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', async (_req, res) => {
    const users = await db.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    res.json(users.map(toAccount));
  });

  router.post('/', async (req, res) => {
    const { name, email, role, password } = parse(newStaffAccountSchema, req.body);
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      throw conflict(`Există deja un cont pentru ${email}.`);
    }
    const user = await db.user.create({
      data: { name, email, role, passwordHash: await hashPassword(password) },
    });
    res.status(201).json(toAccount(user));
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

function toAccount(u: User): StaffAccount {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}
