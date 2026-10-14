import { Router } from 'express';
import type { FinanceSummary, PaymentMethod, UnpaidPeriod } from '../../contract/models.js';
import { fromDbDate, toDbDate } from '../../db.js';
import type { Deps } from '../../deps.js';
import { EXPIRING_WITHIN_DAYS, isActive } from '../../domain/membership.js';
import { today as todayOf } from '../../lib/clock.js';
import { addMonthsToMonth, daysBetween, toIsoDate, toMonth } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { monthSchema, newPaymentSchema, parse } from '../../lib/validation.js';
import { assertAdmin } from '../auth/auth.middleware.js';
import { loadSummaries } from '../members/member-queries.js';
import { paymentInclude, periodInclude, toPayment, toPeriod } from './periods.js';

const METHODS: PaymentMethod[] = ['cash', 'card', 'transfer'];

const monthRange = (month: string) => ({
  gte: toDbDate(`${month}-01`),
  lt: toDbDate(`${addMonthsToMonth(month, 1)}-01`),
});

/** Payments, revenue and subscription sales. Staff only (coaches are blocked in app.ts). */
export function financeRouter({ db, clock }: Deps): Router {
  const router = Router();

  router.get('/finance', async (req, res) => {
    const today = todayOf(clock);
    const month = parse(monthSchema, req.query['month']) ?? toMonth(today);
    const firstMonth = addMonthsToMonth(month, -11);

    const [monthPayments, yearRows, started, summaries, periodsThisMonth] = await Promise.all([
      db.payment.findMany({
        where: { date: monthRange(month) },
        include: paymentInclude,
        orderBy: { paidAt: 'desc' },
      }),
      db.payment.findMany({
        where: { date: { gte: toDbDate(`${firstMonth}-01`), lt: monthRange(month).lt } },
        select: { date: true, amount: true },
      }),
      // Periods that have started (anything later isn't due yet).
      db.subscriptionPeriod.findMany({
        where: { startDate: { lte: toDbDate(today) } },
        include: {
          ...periodInclude,
          member: { select: { firstName: true, lastName: true, phone: true } },
        },
        orderBy: { startDate: 'desc' },
      }),
      loadSummaries(db, today),
      db.subscriptionPeriod.findMany({
        where: { startDate: monthRange(month) },
        select: { memberId: true, startDate: true },
      }),
    ]);

    const perMonth = new Map<string, number>();
    for (const p of yearRows) {
      const m = toMonth(fromDbDate(p.date));
      perMonth.set(m, (perMonth.get(m) ?? 0) + p.amount);
    }
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = addMonthsToMonth(firstMonth, i);
      return { month: m, amount: perMonth.get(m) ?? 0 };
    });

    const currentStart = new Map(
      summaries.map((m) => [m.id, m.subscription?.startDate ?? null] as const),
    );
    const unpaid: UnpaidPeriod[] = started
      .map((row) => ({ row, period: toPeriod(row, currentStart.get(row.memberId) ?? null) }))
      .filter(({ period }) => period.status === 'unpaid' || period.status === 'partial')
      .map(({ row, period }) => ({
        ...period,
        memberId: row.memberId,
        memberName: `${row.member.firstName} ${row.member.lastName}`,
        phone: row.member.phone,
      }));

    // A renewal is a period sold to a member who already had an earlier one.
    const earlier = await db.subscriptionPeriod.groupBy({
      by: ['memberId'],
      where: {
        memberId: { in: periodsThisMonth.map((p) => p.memberId) },
        startDate: { lt: monthRange(month).gte },
      },
    });
    const returning = new Set(earlier.map((e) => e.memberId));

    const activeByPlan = new Map<
      string,
      { planId: UnpaidPeriod['planId']; planName: string; count: number }
    >();
    for (const m of summaries) {
      if (!m.subscription || !isActive(m.status)) continue;
      const entry = activeByPlan.get(m.subscription.planId) ?? {
        planId: m.subscription.planId,
        planName: m.subscription.planName,
        count: 0,
      };
      entry.count++;
      activeByPlan.set(m.subscription.planId, entry);
    }

    const body: FinanceSummary = {
      month,
      revenue: monthPayments.reduce((sum, p) => sum + p.amount, 0),
      revenuePrevious: perMonth.get(addMonthsToMonth(month, -1)) ?? 0,
      byMethod: METHODS.map((method) => ({
        method,
        amount: monthPayments.filter((p) => p.method === method).reduce((s, p) => s + p.amount, 0),
      })),
      monthly,
      outstanding: unpaid.reduce((sum, p) => sum + (p.due ?? 0), 0),
      unpaid,
      unpricedPeriods: started.filter((p) => p.price === null).length,
      subscriptions: {
        activeByPlan: [...activeByPlan.values()],
        soldThisMonth: periodsThisMonth.length,
        renewalsThisMonth: periodsThisMonth.filter((p) => returning.has(p.memberId)).length,
        expiringSoon: summaries.filter(
          (m) =>
            !!m.subscription &&
            m.status !== 'expired' &&
            daysBetween(today, m.subscription.endDate) < EXPIRING_WITHIN_DAYS,
        ).length,
      },
      payments: monthPayments.map(toPayment),
    };
    res.json(body);
  });

  router.post('/payments', async (req, res) => {
    const input = parse(newPaymentSchema, req.body);
    if (!(await db.member.count({ where: { id: input.memberId } }))) {
      throw notFound('Membrul nu a fost găsit.');
    }
    if (input.periodId) {
      const period = await db.subscriptionPeriod.findUnique({ where: { id: input.periodId } });
      if (!period || period.memberId !== input.memberId) {
        throw badRequest('Perioada de abonament nu aparține acestui membru.');
      }
    }
    const now = clock();
    const payment = await db.payment.create({
      data: {
        memberId: input.memberId,
        periodId: input.periodId,
        amount: input.amount,
        method: input.method,
        note: input.note,
        paidAt: now,
        date: toDbDate(toIsoDate(now)),
        receivedById: req.user?.id ?? null,
      },
      include: paymentInclude,
    });
    res.status(201).json(toPayment(payment));
  });

  /** Corrections only: deleting money records is admin-only. */
  router.delete('/payments/:id', async (req, res) => {
    assertAdmin(req);
    await db.payment.deleteMany({ where: { id: req.params.id } });
    res.status(204).end();
  });

  return router;
}
