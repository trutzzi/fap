import { Router } from 'express';
import type { Announcement, AnnouncementAudience } from '../../contract/models.js';
import type { Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { isActive } from '../../domain/membership.js';
import { today } from '../../lib/clock.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { announcementSchema, parse } from '../../lib/validation.js';
import { loadSummaries } from '../members/member-queries.js';

/**
 * Announcements from staff (admin and reception; coaches are not in their allowlist) to
 * members, shown in the member portal. Recipients are resolved when it is sent.
 */
export function announcementsRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/announcements', async (_req, res) => {
    res.json(await listAnnouncements(db));
  });

  router.post('/announcements', async (req, res) => {
    const { title, body, audience } = parse(announcementSchema, req.body);
    const { memberIds, label } = await resolveAudience(db, audience, today(clock));
    if (memberIds.length === 0) {
      throw badRequest('Niciun membru nu corespunde destinatarilor aleși.');
    }
    const created = await db.announcement.create({
      data: {
        title,
        body,
        audienceLabel: label,
        createdAt: clock(),
        createdById: req.user?.id ?? null,
        recipients: { createMany: { data: memberIds.map((memberId) => ({ memberId })) } },
      },
      select: { id: true },
    });
    res.status(201).json((await listAnnouncements(db, created.id))[0]);
  });

  router.delete('/announcements/:id', async (req, res) => {
    const { count } = await db.announcement.deleteMany({ where: { id: req.params.id } });
    if (count === 0) throw notFound('Anunțul nu a fost găsit.');
    res.status(204).end();
  });

  return router;
}

async function resolveAudience(
  db: Db,
  audience: AnnouncementAudience,
  todayIso: string,
): Promise<{ memberIds: string[]; label: string }> {
  switch (audience.kind) {
    case 'all': {
      const rows = await db.member.findMany({ select: { id: true } });
      return { memberIds: rows.map((r) => r.id), label: 'Toți membrii' };
    }
    case 'active': {
      const members = await loadSummaries(db, todayIso);
      return {
        memberIds: members.filter((m) => isActive(m.status)).map((m) => m.id),
        label: 'Cu abonament valabil',
      };
    }
    case 'course': {
      const course = await db.course.findUnique({
        where: { id: audience.courseId },
        select: { name: true, members: { select: { memberId: true } } },
      });
      if (!course) throw badRequest('Cursul ales nu există.');
      return { memberIds: course.members.map((m) => m.memberId), label: `Curs: ${course.name}` };
    }
    case 'members': {
      const rows = await db.member.findMany({
        where: { id: { in: audience.memberIds } },
        select: { id: true },
      });
      if (rows.length !== audience.memberIds.length)
        throw badRequest('Unul dintre membri nu există.');
      const n = rows.length;
      return {
        memberIds: rows.map((r) => r.id),
        label: n === 1 ? '1 membru ales' : `${n} membri aleși`,
      };
    }
  }
}

async function listAnnouncements(db: Db, id?: string): Promise<Announcement[]> {
  const rows = await db.announcement.findMany({
    where: id ? { id } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  });
  const read = await db.announcementRecipient.groupBy({
    by: ['announcementId'],
    where: { announcementId: { in: rows.map((r) => r.id) }, readAt: { not: null } },
    _count: { _all: true },
  });
  const readBy = new Map(read.map((r) => [r.announcementId, r._count._all]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy?.name ?? null,
    audienceLabel: r.audienceLabel,
    recipients: r._count.recipients,
    read: readBy.get(r.id) ?? 0,
  }));
}
