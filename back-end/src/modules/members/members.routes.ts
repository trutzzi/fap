import { Router } from 'express';
import type {
  MemberAttendance,
  MemberFilter,
  MemberSummary,
  MembersPage,
} from '../../contract/models.js';
import { fromDbDate, toDbDate, type Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { isActive, matchesSearch, normalizeRfid } from '../../domain/membership.js';
import { today } from '../../lib/clock.js';
import { addMonthsToMonth, toMonth } from '../../lib/dates.js';
import { badRequest, conflict, notFound } from '../../lib/http-error.js';
import {
  memberSchema,
  membersQuerySchema,
  monthSchema,
  newMemberSchema,
  parse,
  rfidInputSchema,
  subscriptionSchema,
} from '../../lib/validation.js';
import { assertAdmin } from '../auth/auth.middleware.js';
import { periodInclude, sellSubscription, toPeriod } from '../finance/periods.js';
import { checkInHistory, loadSummaries, loadSummary } from './member-queries.js';

const FILTERS: Record<MemberFilter, (m: MemberSummary) => boolean> = {
  all: () => true,
  active: (m) => isActive(m.status),
  expiring: (m) => m.status === 'expiring',
  limit: (m) => m.status === 'limit',
  expired: (m) => m.status === 'expired' || m.status === 'none',
  'no-card': (m) => m.rfid === null,
};

/** Normalizes the card code and rejects one already assigned to someone else. */
async function checkRfid(
  db: Db,
  raw: string | null,
  memberId: string | null,
): Promise<string | null> {
  if (!raw) return null;
  const rfid = normalizeRfid(raw);
  if (!/^[0-9A-F]{4,20}$/.test(rfid)) {
    throw badRequest('Codul cardului RFID trebuie să conțină 4–20 caractere hexazecimale.');
  }
  const owner = await db.member.findUnique({
    where: { rfid },
    select: { id: true, firstName: true, lastName: true },
  });
  if (owner && owner.id !== memberId) {
    throw conflict(`Cardul este deja alocat lui ${owner.firstName} ${owner.lastName}.`);
  }
  return rfid;
}

async function checkCourses(db: Db, courseIds: string[]): Promise<void> {
  const found = await db.course.count({ where: { id: { in: courseIds } } });
  if (found !== courseIds.length) throw badRequest('Unul dintre cursuri nu există.');
}

export function membersRouter({ db, clock }: Deps): Router {
  const router = Router();

  const summaryOrThrow = async (id: string) => {
    const member = await loadSummary(db, id, today(clock));
    if (!member) throw notFound('Membrul nu a fost găsit.');
    return member;
  };

  // Gym-sized data (hundreds of members): statuses depend on usage, so filtering and
  // paging happen in memory after a single aggregated load.
  router.get('/', async (req, res) => {
    const query = parse(membersQuerySchema, req.query);
    const all = await loadSummaries(db, today(clock));
    const filtered = all.filter(
      (m) =>
        FILTERS[query.filter](m) &&
        (!query.courseId || m.courses.some((c) => c.id === query.courseId)) &&
        matchesSearch(m, query.q ?? ''),
    );
    const pages = Math.max(Math.ceil(filtered.length / query.pageSize), 1);
    const page = Math.min(query.page, pages);
    const activeCount = all.filter(FILTERS.active).length;
    const body: MembersPage = {
      items: filtered.slice((page - 1) * query.pageSize, page * query.pageSize),
      total: filtered.length,
      page,
      pageSize: query.pageSize,
      activeCount,
      inactiveCount: all.length - activeCount,
    };
    res.json(body);
  });

  router.post('/', async (req, res) => {
    const input = parse(newMemberSchema, req.body);
    await checkCourses(db, input.courseIds);
    const rfid = await checkRfid(db, input.rfid, null);
    const member = await db.member.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        email: input.email,
        rfid,
        photoConsent: input.photoConsent,
        joinedAt: toDbDate(today(clock)),
        courses: { create: input.courseIds.map((courseId) => ({ courseId })) },
      },
    });
    if (input.subscription) {
      const sub = input.subscription;
      await db.$transaction((tx) =>
        sellSubscription(tx, {
          memberId: member.id,
          ...sub,
          userId: req.user?.id ?? null,
          now: clock(),
        }),
      );
    }
    res.status(201).json(await summaryOrThrow(member.id));
  });

  router.get('/:id', async (req, res) => {
    const member = await summaryOrThrow(req.params.id);
    const periods = await db.subscriptionPeriod.findMany({
      where: { memberId: member.id },
      include: periodInclude,
      orderBy: { startDate: 'desc' },
      take: 12,
    });
    res.json({
      ...member,
      history: await checkInHistory(db, member, 20),
      periods: periods.map((p) => toPeriod(p, member.subscription?.startDate ?? null)),
    });
  });

  router.put('/:id', async (req, res) => {
    const id = req.params.id;
    await summaryOrThrow(id);
    const input = parse(memberSchema, req.body);
    await checkCourses(db, input.courseIds);
    const rfid = await checkRfid(db, input.rfid, id);
    await db.$transaction([
      db.memberCourse.deleteMany({ where: { memberId: id } }),
      // GDPR: withdrawing consent removes the stored photo straight away.
      ...(input.photoConsent ? [] : [db.memberPhoto.deleteMany({ where: { memberId: id } })]),
      db.member.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          email: input.email,
          rfid,
          photoConsent: input.photoConsent,
          courses: { create: input.courseIds.map((courseId) => ({ courseId })) },
        },
      }),
    ]);
    res.json(await summaryOrThrow(id));
  });

  router.delete('/:id', async (req, res) => {
    assertAdmin(req);
    await summaryOrThrow(req.params.id);
    await db.member.delete({ where: { id: req.params.id } });
    res.status(204).end();
  });

  router.put('/:id/subscription', async (req, res) => {
    const id = req.params.id;
    await summaryOrThrow(id);
    const input = parse(subscriptionSchema, req.body);
    await db.$transaction((tx) =>
      sellSubscription(tx, { memberId: id, ...input, userId: req.user?.id ?? null, now: clock() }),
    );
    res.json(await summaryOrThrow(id));
  });

  router.put('/:id/rfid', async (req, res) => {
    const id = req.params.id;
    await summaryOrThrow(id);
    const { rfid } = parse(rfidInputSchema, req.body);
    await db.member.update({ where: { id }, data: { rfid: await checkRfid(db, rfid, id) } });
    res.json(await summaryOrThrow(id));
  });

  router.get('/:id/attendance', async (req, res) => {
    const id = req.params.id;
    await summaryOrThrow(id);
    const month = parse(monthSchema, req.query['month']) ?? toMonth(today(clock));
    const rows = await db.checkIn.findMany({
      where: {
        memberId: id,
        date: { gte: toDbDate(`${month}-01`), lt: toDbDate(`${addMonthsToMonth(month, 1)}-01`) },
      },
      select: { date: true },
      distinct: ['date'],
      orderBy: { date: 'asc' },
    });
    const body: MemberAttendance = {
      month,
      days: rows.map((r) => Number(fromDbDate(r.date).slice(8, 10))),
    };
    res.json(body);
  });

  return router;
}
