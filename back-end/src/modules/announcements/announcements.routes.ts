import { Router } from 'express';
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementPreview,
} from '../../contract/models.js';
import type { Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { isActive } from '../../domain/membership.js';
import { today } from '../../lib/clock.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { announcementSchema, parse } from '../../lib/validation.js';
import { announcementSmsText, smsRecipient } from '../../domain/member-access.js';
import { loadClub } from '../club/club.routes.js';
import { recordError } from '../logs/uptime-checks.js';
import { loadSummaries } from '../members/member-queries.js';
import { notifyMembers, sendSms } from '../notifications/notify.js';

/**
 * Announcements from staff (admin and reception; coaches are not in their allowlist) to
 * members, shown in the member portal. Recipients are resolved when it is sent.
 */
export function announcementsRouter(deps: Deps): Router {
  const { db, clock } = deps;
  const router = Router();

  router.get('/announcements', async (_req, res) => {
    res.json(await listAnnouncements(db));
  });

  router.post('/announcements', async (req, res) => {
    const { title, body, audience, sms } = parse(announcementSchema, req.body);
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
    await notifyMembers(deps, memberIds, {
      kind: 'announcement',
      title: `Anunț nou: ${title}`,
      body: body.length > 140 ? `${body.slice(0, 137).trimEnd()}…` : body,
    });
    if (sms) await startSms(deps, created.id, memberIds, title, body);
    res.status(201).json((await listAnnouncements(db, created.id))[0]);
  });

  /** What sending to an audience would mean: recipients and SMS (one per phone). */
  router.post('/announcements/preview', async (req, res) => {
    const { audience } = parse(announcementSchema.pick({ audience: true }), req.body);
    const { memberIds } = await resolveAudience(db, audience, today(clock));
    const phones = await db.member.findMany({
      where: { id: { in: memberIds } },
      select: { phone: true },
    });
    const body: AnnouncementPreview = {
      recipients: memberIds.length,
      smsCount: new Set(phones.map((m) => smsRecipient(m.phone)).filter(Boolean)).size,
    };
    res.json(body);
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
    sms:
      r.smsRecipients > 0
        ? { recipients: r.smsRecipients, sent: r.smsSent, failed: r.smsFailed }
        : null,
  }));
}

/**
 * Texts the announcement once per phone number (siblings share one), in the background so
 * the request returns right away; progress is kept on the announcement for the staff list.
 * Failures are summed up in one logs-page entry.
 */
async function startSms(
  { db, sms, clock, publicUrl }: Pick<Deps, 'db' | 'sms' | 'clock' | 'publicUrl'>,
  announcementId: string,
  memberIds: string[],
  title: string,
  body: string,
): Promise<void> {
  const members = await db.member.findMany({
    where: { id: { in: memberIds } },
    select: { id: true, phone: true },
  });
  // One SMS per phone (siblings share one); the log names the first member with it.
  const byPhone = new Map<string, string>();
  for (const m of members) {
    const to = smsRecipient(m.phone);
    if (to && !byPhone.has(to)) byPhone.set(to, m.id);
  }
  const phones = [...byPhone.keys()];
  if (phones.length === 0) return;
  await db.announcement.update({
    where: { id: announcementId },
    data: { smsRecipients: phones.length },
  });
  const club = await loadClub(db);
  const text = announcementSmsText(club.name, title, body, `${publicUrl}/cont`);

  void (async () => {
    let lastError = '';
    let failed = 0;
    for (const to of phones) {
      const { ok, error } = await sendSms(
        { db, sms, clock },
        { memberId: byPhone.get(to) ?? null, to, kind: 'announcement', text },
      );
      if (!ok) lastError = error ?? '';
      if (!ok) failed++;
      await db.announcement
        .update({
          where: { id: announcementId },
          data: ok ? { smsSent: { increment: 1 } } : { smsFailed: { increment: 1 } },
        })
        .catch(() => undefined); // withdrawn meanwhile
    }
    if (failed > 0) {
      await recordError(
        db,
        'sms',
        `Announcement "${title}": ${failed} of ${phones.length} SMS failed (${lastError})`,
      );
    }
  })();
}
