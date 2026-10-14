import { Router } from 'express';
import type { Club } from '../../contract/models.js';
import type { Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { clubSchema, parse } from '../../lib/validation.js';
import { requireAdmin } from '../auth/auth.middleware.js';

const CLUB_ID = 1;

/** Used until the admin saves the club details for the first time. */
export const DEFAULT_CLUB: Club = {
  name: 'Fight Academy',
  address: '',
  phone: '',
  email: '',
  website: '',
  timezone: 'Europe/Bucharest',
};

export async function loadClub(db: Db, defaults: Club = DEFAULT_CLUB): Promise<Club> {
  const row = await db.club.findUnique({ where: { id: CLUB_ID } });
  if (!row) return defaults;
  const { name, address, phone, email, website, timezone } = row;
  return { name, address, phone, email, website, timezone };
}

/**
 * All date logic ("today", training times, check-in dates) runs in the club's timezone.
 * Node re-reads `TZ` on change, so this applies immediately.
 */
export function applyTimezone(club: Club): void {
  process.env['TZ'] = club.timezone;
}

/** GET is public (the login page shows the club name); PUT is admin-only. */
export function clubRouter({ db }: Deps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await loadClub(db));
  });

  router.put('/', requireAdmin, async (req, res) => {
    const input = parse(clubSchema, req.body);
    await db.club.upsert({
      where: { id: CLUB_ID },
      create: { id: CLUB_ID, ...input },
      update: input,
    });
    const club = await loadClub(db);
    applyTimezone(club);
    res.json(club);
  });

  return router;
}
