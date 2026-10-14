import express, { Router } from 'express';
import { toDbDate } from '../../db.js';
import type { Deps } from '../../deps.js';
import { today } from '../../lib/clock.js';
import { HttpError, badRequest, conflict, notFound } from '../../lib/http-error.js';
import { loadSummary } from './member-queries.js';

/** Photos are resized in the browser (~50 KB); anything this big is not a member photo. */
export const MAX_PHOTO_BYTES = 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Checks the file signature, so a renamed non-image is rejected whatever its header says. */
function detectImageType(data: Buffer): (typeof PHOTO_TYPES)[number] | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * `GET|PUT|DELETE /members/:id/photo`. Mounted before the members router.
 * Staff may view any photo; a coach only photos of members in their courses or of members
 * who scanned at one of their trainings today. Writing is staff-only (enforced in app.ts).
 */
export function memberPhotosRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/:id/photo', async (req, res) => {
    const id = req.params.id;
    if (req.user?.role === 'coach') {
      const coachId = req.user.id;
      const date = toDbDate(today(clock));
      const visible = await db.member.count({
        where: {
          id,
          OR: [
            { courses: { some: { course: { coachUserId: coachId } } } },
            { checkIns: { some: { date, slot: { course: { coachUserId: coachId } } } } },
            { refusedScans: { some: { date, slot: { course: { coachUserId: coachId } } } } },
          ],
        },
      });
      if (!visible) throw new HttpError(403, 'Nu ai drepturi pentru această acțiune.');
    }
    const photo = await db.memberPhoto.findUnique({ where: { memberId: id } });
    if (!photo) throw notFound('Membrul nu are fotografie.');
    res
      .type(photo.mimeType)
      // Private: personal data must not be stored by shared caches. The URL is versioned.
      .set('Cache-Control', 'private, max-age=86400')
      .set('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(photo.data));
  });

  router.put(
    '/:id/photo',
    express.raw({ type: [...PHOTO_TYPES], limit: MAX_PHOTO_BYTES }),
    async (req, res) => {
      const id = req.params.id;
      const member = await loadSummary(db, id, today(clock));
      if (!member) throw notFound('Membrul nu a fost găsit.');
      if (!member.photoConsent) {
        throw conflict('Bifează mai întâi acordul pentru fotografie (GDPR).');
      }
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const bytes = new Uint8Array(data);
      const mimeType = detectImageType(data);
      if (!mimeType) throw badRequest('Fișierul trebuie să fie o imagine JPEG, PNG sau WebP.');
      await db.memberPhoto.upsert({
        where: { memberId: id },
        create: { memberId: id, mimeType, data: bytes },
        update: { mimeType, data: bytes },
      });
      res.json(await loadSummary(db, id, today(clock)));
    },
  );

  router.delete('/:id/photo', async (req, res) => {
    const id = req.params.id;
    await db.memberPhoto.deleteMany({ where: { memberId: id } });
    const member = await loadSummary(db, id, today(clock));
    if (!member) throw notFound('Membrul nu a fost găsit.');
    res.json(member);
  });

  return router;
}
