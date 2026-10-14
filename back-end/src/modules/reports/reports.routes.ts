import { Router } from 'express';
import type { CourseReport, InactiveMember, ReportsSummary } from '../../contract/models.js';
import { fromDbDate, toDbDate } from '../../db.js';
import type { Deps } from '../../deps.js';
import { isActive } from '../../domain/membership.js';
import { today as todayOf } from '../../lib/clock.js';
import {
  addDays,
  addMonthsToMonth,
  daysBetween,
  daysInMonth,
  isoWeekday,
  toIsoDate,
  toMonth,
} from '../../lib/dates.js';
import { monthSchema, parse } from '../../lib/validation.js';
import { METHOD_LABELS } from '../finance/labels.js';
import { periodLabel } from '../finance/periods.js';
import { loadSummaries } from '../members/member-queries.js';
import { sendCsv } from './csv.js';

/** Members are "inactive" after this many days without a check-in. */
const INACTIVE_DAYS = 14;

const STATUS_LABELS: Record<string, string> = {
  active: 'Activ',
  expiring: 'Expiră curând',
  limit: 'Limită atinsă',
  expired: 'Expirat',
  none: 'Fără abonament',
};

const monthRange = (month: string) => ({
  gte: toDbDate(`${month}-01`),
  lt: toDbDate(`${addMonthsToMonth(month, 1)}-01`),
});

/** Attendance reports and CSV exports (staff only; coaches are blocked in app.ts). */
export function reportsRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/reports', async (req, res) => {
    const today = todayOf(clock);
    const month = parse(monthSchema, req.query['month']) ?? toMonth(today);
    const [checkIns, refused, courses, slots, summaries, lastSeen] = await Promise.all([
      db.checkIn.findMany({
        where: { date: monthRange(month) },
        select: {
          memberId: true,
          timestamp: true,
          slot: { select: { courseId: true } },
          member: { select: { firstName: true, lastName: true } },
        },
      }),
      db.refusedScan.count({ where: { date: monthRange(month) } }),
      db.course.findMany({ orderBy: { createdAt: 'asc' } }),
      db.trainingSlot.findMany({ select: { courseId: true, weekday: true } }),
      loadSummaries(db, today),
      db.checkIn.groupBy({ by: ['memberId'], _max: { date: true } }),
    ]);

    // Trainings held per weekday in the month (only days up to today count).
    const lastDay = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const weekdayCount = new Map<number, number>();
    for (let d = `${month}-01`; d <= lastDay && d <= today; d = addDays(d, 1)) {
      weekdayCount.set(isoWeekday(d), (weekdayCount.get(isoWeekday(d)) ?? 0) + 1);
    }

    const byCourse: CourseReport[] = [
      ...courses.map((c) => ({ courseId: c.id, name: c.name, color: c.color })),
      { courseId: null, name: 'Acces liber / altele', color: '#a0a0a8' },
    ]
      .map(({ courseId, name, color }) => {
        const rows = checkIns.filter((c) => (c.slot?.courseId ?? null) === courseId);
        const trainings = courseId
          ? slots
              .filter((s) => s.courseId === courseId)
              .reduce((sum, s) => sum + (weekdayCount.get(s.weekday) ?? 0), 0)
          : 0;
        return {
          courseId,
          name,
          color,
          checkins: rows.length,
          members: new Set(rows.map((r) => r.memberId)).size,
          trainings,
          average: trainings ? Math.round((rows.length / trainings) * 10) / 10 : null,
        };
      })
      .filter((c) => c.courseId !== null || c.checkins > 0);

    const cells = new Map<string, number>();
    for (const c of checkIns) {
      const key = `${isoWeekday(toIsoDate(c.timestamp))}|${c.timestamp.getHours()}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }

    const last = new Map(
      lastSeen.map((r) => [r.memberId, r._max.date ? fromDbDate(r._max.date) : null]),
    );
    const inactive: InactiveMember[] = summaries
      .filter((m) => m.subscription && isActive(m.status))
      .map((m) => {
        const lastCheckIn = last.get(m.id) ?? null;
        return {
          memberId: m.id,
          fullName: m.fullName,
          phone: m.phone,
          planName: m.subscription!.planName,
          lastCheckIn,
          daysSince: lastCheckIn ? daysBetween(lastCheckIn, today) : null,
        };
      })
      .filter((m) => m.daysSince === null || m.daysSince >= INACTIVE_DAYS)
      .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity));

    const perMember = new Map<string, { fullName: string; checkins: number }>();
    for (const c of checkIns) {
      const entry = perMember.get(c.memberId) ?? {
        fullName: `${c.member.firstName} ${c.member.lastName}`,
        checkins: 0,
      };
      entry.checkins++;
      perMember.set(c.memberId, entry);
    }

    const body: ReportsSummary = {
      month,
      totals: { checkins: checkIns.length, members: perMember.size, refused },
      byCourse,
      heatmap: [...cells.entries()].map(([key, count]) => {
        const [weekday, hour] = key.split('|').map(Number);
        return { weekday: weekday, hour: hour, count };
      }),
      inactive,
      inactiveDays: INACTIVE_DAYS,
      topMembers: [...perMember.entries()]
        .map(([memberId, v]) => ({ memberId, ...v }))
        .sort((a, b) => b.checkins - a.checkins || a.fullName.localeCompare(b.fullName, 'ro'))
        .slice(0, 10),
    };
    res.json(body);
  });

  // ---- CSV exports ----

  router.get('/reports/attendance.csv', async (req, res) => {
    const month = parse(monthSchema, req.query['month']) ?? toMonth(todayOf(clock));
    const rows = await db.checkIn.findMany({
      where: { date: monthRange(month) },
      include: { member: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { timestamp: 'asc' },
    });
    sendCsv(
      res,
      `prezente-${month}.csv`,
      ['Data', 'Ora', 'Membru', 'Telefon', 'Antrenament', 'Metodă'],
      rows.map((c) => [
        fromDbDate(c.date),
        c.timestamp.toTimeString().slice(0, 5),
        `${c.member.firstName} ${c.member.lastName}`,
        c.member.phone,
        c.trainingLabel ?? 'Acces liber',
        c.method === 'rfid' ? 'Card RFID' : 'Manual',
      ]),
    );
  });

  router.get('/reports/payments.csv', async (req, res) => {
    const month = parse(monthSchema, req.query['month']) ?? toMonth(todayOf(clock));
    const rows = await db.payment.findMany({
      where: { date: monthRange(month) },
      include: {
        member: { select: { firstName: true, lastName: true } },
        receivedBy: { select: { name: true } },
        period: { select: { startDate: true, endDate: true, plan: { select: { name: true } } } },
      },
      orderBy: { paidAt: 'asc' },
    });
    sendCsv(
      res,
      `plati-${month}.csv`,
      ['Data', 'Membru', 'Abonament', 'Metodă', 'Sumă (lei)', 'Încasat de', 'Notă'],
      rows.map((p) => [
        fromDbDate(p.date),
        `${p.member.firstName} ${p.member.lastName}`,
        p.period ? periodLabel(p.period.plan.name, p.period.startDate, p.period.endDate) : '',
        METHOD_LABELS[p.method],
        p.amount,
        p.receivedBy?.name ?? '',
        p.note,
      ]),
    );
  });

  router.get('/reports/members.csv', async (_req, res) => {
    const members = await loadSummaries(db, todayOf(clock));
    sendCsv(
      res,
      `membri-${todayOf(clock)}.csv`,
      [
        'Nume',
        'Telefon',
        'Email',
        'Cursuri',
        'Abonament',
        'Valabil până la',
        'Ședințe folosite',
        'Status',
        'Card RFID',
      ],
      members.map((m) => [
        m.fullName,
        m.phone,
        m.email,
        m.courses.map((c) => c.name).join(', '),
        m.subscription?.planName ?? '',
        m.subscription?.endDate ?? '',
        m.subscription ? m.subscription.used : '',
        STATUS_LABELS[m.status] ?? m.status,
        m.rfid ?? '',
      ]),
    );
  });

  return router;
}
