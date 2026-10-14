import { Router } from 'express';
import type { Alert, Dashboard, RecentCheckIn, WeekSchedule } from '../../contract/models.js';
import { fromDbDate, toDbDate, type Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { EXPIRING_WITHIN_DAYS, initials, isActive } from '../../domain/membership.js';
import { trainingState } from '../../domain/schedule.js';
import { today as todayOf } from '../../lib/clock.js';
import {
  addDays,
  addMonthsToMonth,
  daysBetween,
  formatDayMonth,
  startOfWeek,
  toMonth,
} from '../../lib/dates.js';
import { parse, weekSchema } from '../../lib/validation.js';
import { loadSummaries, photoUrl } from '../members/member-queries.js';
import { trainingsToday } from '../trainings/trainings-today.js';

const slotLabel = (slot: { label: string | null; course: { name: string } }) =>
  slot.label ?? slot.course.name;

/** Check-in counts per `slotId|date` between two dates (inclusive). */
async function attendanceBySlot(db: Db, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db.checkIn.groupBy({
    by: ['slotId', 'date'],
    where: { slotId: { not: null }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [`${r.slotId}|${fromDbDate(r.date)}`, r._count._all]));
}

async function countBetween(db: Db, from: string, toExclusive: string): Promise<number> {
  return db.checkIn.count({ where: { date: { gte: toDbDate(from), lt: toDbDate(toExclusive) } } });
}

/** Read-only aggregates: the weekly schedule and the dashboard. */
export function insightsRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/schedule', async (req, res) => {
    const now = clock();
    const weekStart = startOfWeek(parse(weekSchema, req.query['week']) ?? todayOf(clock));
    const [slots, attendance] = await Promise.all([
      db.trainingSlot.findMany({ include: { course: true }, orderBy: { time: 'asc' } }),
      // This week plus the previous 4, for averages.
      attendanceBySlot(db, addDays(weekStart, -28), addDays(weekStart, 6)),
    ]);
    const at = (slotId: string, date: string) => attendance.get(`${slotId}|${date}`) ?? 0;

    const body: WeekSchedule = {
      weekStart,
      days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        return {
          date,
          weekday: i + 1,
          isToday: date === todayOf(clock),
          entries: slots
            .filter((s) => s.weekday === i + 1)
            .map(({ course, ...slot }) => {
              const state = trainingState(date, slot, now);
              const previous = [1, 2, 3, 4].map((w) => at(slot.id, addDays(date, -7 * w)));
              const total = previous.reduce((sum, n) => sum + n, 0);
              return {
                slot,
                name: slot.label ?? course.name,
                color: course.color,
                coach: course.coach,
                state,
                attendance: state === 'upcoming' ? null : at(slot.id, date),
                average: total > 0 ? Math.round(total / previous.length) : null,
              };
            }),
        };
      }),
    };
    res.json(body);
  });

  router.get('/dashboard', async (_req, res) => {
    const now = clock();
    const today = todayOf(clock);
    const month = toMonth(today);
    const monthStart = `${month}-01`;
    const weekFrom = addDays(today, -6);

    const [summaries, todays, weekRows, busiestRows, recent, thisMonth, lastMonth, newMembers] =
      await Promise.all([
        loadSummaries(db, today),
        trainingsToday(db, now),
        db.checkIn.groupBy({
          by: ['date'],
          where: { date: { gte: toDbDate(weekFrom), lte: toDbDate(today) } },
          _count: { _all: true },
        }),
        db.checkIn.groupBy({
          by: ['slotId'],
          where: { slotId: { not: null }, date: { gte: toDbDate(weekFrom) } },
          _count: { slotId: true },
          orderBy: { _count: { slotId: 'desc' } },
          take: 1,
        }),
        db.checkIn.findMany({
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          take: 6,
          include: {
            member: {
              include: {
                subscription: { include: { plan: true } },
                photo: { select: { updatedAt: true } },
              },
            },
          },
        }),
        countBetween(db, monthStart, `${addMonthsToMonth(month, 1)}-01`),
        countBetween(db, `${addMonthsToMonth(month, -1)}-01`, monthStart),
        db.member.count({ where: { joinedAt: { gte: toDbDate(monthStart) } } }),
      ]);

    const perDay = new Map(weekRows.map((r) => [fromDbDate(r.date), r._count._all]));
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekFrom, i);
      return { date, count: perDay.get(date) ?? 0 };
    });

    const busiestId = busiestRows[0]?.slotId;
    const busiest = busiestId
      ? await db.trainingSlot.findUnique({ where: { id: busiestId }, include: { course: true } })
      : null;

    // "8 / 12": the check-in's position within its member's current period.
    const recentCheckins: RecentCheckIn[] = await Promise.all(
      recent.map(async (c) => {
        const sub = c.member.subscription;
        let usageLabel = '—';
        let warn = false;
        if (sub && sub.plan.sessionLimit === null) {
          usageLabel = 'Nelimitat';
        } else if (sub && c.date >= sub.startDate && c.date <= sub.endDate) {
          const n = await db.checkIn.count({
            where: {
              memberId: c.memberId,
              date: { gte: sub.startDate, lte: sub.endDate },
              timestamp: { lte: c.timestamp },
            },
          });
          const limit = sub.plan.sessionLimit!;
          usageLabel = `${n} / ${limit}`;
          warn = n >= limit - 1;
        }
        return {
          id: c.id,
          memberId: c.memberId,
          initials: initials(c.member.firstName, c.member.lastName),
          fullName: `${c.member.firstName} ${c.member.lastName}`,
          photoUrl: photoUrl(c.memberId, c.member.photo),
          trainingLabel: c.trainingLabel,
          timestamp: c.timestamp.toISOString(),
          usageLabel,
          warn,
        };
      }),
    );

    const endingSoon = (m: (typeof summaries)[number]) =>
      !!m.subscription &&
      m.status !== 'expired' &&
      daysBetween(today, m.subscription.endDate) < EXPIRING_WITHIN_DAYS;

    const alerts: Alert[] = [
      ...summaries
        .filter((m) => m.status === 'limit')
        .map((m) => ({
          kind: 'limit' as const,
          memberId: m.id,
          title: m.fullName,
          detail: `A atins limita de ${m.subscription!.sessionLimit} ședințe · expiră ${formatDayMonth(m.subscription!.endDate)}`,
        })),
      ...summaries
        .filter((m) => endingSoon(m) && m.status !== 'limit')
        .sort(
          (a, b) =>
            a.subscription!.endDate.localeCompare(b.subscription!.endDate) ||
            a.fullName.localeCompare(b.fullName, 'ro'),
        )
        .map((m) => ({
          kind: 'expiring' as const,
          memberId: m.id,
          title: m.fullName,
          detail: `Abonament ${m.subscription!.planName} expiră pe ${formatDayMonth(m.subscription!.endDate)}`,
        })),
    ].slice(0, 5);
    const withoutCard = summaries.filter((m) => m.rfid === null).length;
    if (withoutCard > 0) {
      alerts.push({
        kind: 'no-card',
        memberId: null,
        title: 'Card RFID nealocat',
        detail: withoutCard === 1 ? '1 membru fără card' : `${withoutCard} membri fără card`,
      });
    }

    const body: Dashboard = {
      activeMembers: summaries.filter((m) => isActive(m.status)).length,
      newMembersThisMonth: newMembers,
      checkinsToday: perDay.get(today) ?? 0,
      checkinsThisMonth: thisMonth,
      checkinsLastMonth: lastMonth,
      expiringSoon: summaries.filter(endingSoon).length,
      today: todays.trainings,
      openGym: todays.openGym,
      week,
      weekAverage: Math.round(week.reduce((sum, d) => sum + d.count, 0) / week.length),
      busiestTraining: busiest ? `${slotLabel(busiest)} ${busiest.time}` : null,
      recentCheckins,
      alerts,
    };
    res.json(body);
  });

  return router;
}
