import {
  FinanceSummary,
  Payment,
  PaymentInput,
  PaymentMethod,
  PlanId,
  SubscriptionPeriod,
  UnpaidPeriod,
} from '../../app/core/api/models';
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  daysBetween,
  formatDayMonth,
  toIsoDate,
  toMonth,
} from '../../app/core/util/dates';
import { Db, PeriodEntity, nextId } from './db';
import { Views } from './views';

const METHODS: PaymentMethod[] = ['cash', 'card', 'transfer'];

/** Mock of the back-end's subscription periods, payments and finance summary. */
export class MockFinance {
  constructor(
    private readonly db: Db,
    private readonly views: Views,
  ) {}

  private paid(periodId: string): number {
    return this.db.payments
      .filter((p) => p.periodId === periodId)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  toPeriod(p: PeriodEntity, currentStart: string | null): SubscriptionPeriod {
    const paid = this.paid(p.id);
    const status =
      p.price === null ? 'no-price' : paid >= p.price ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
    return {
      id: p.id,
      planId: p.planId,
      planName: this.db.plans.find((x) => x.id === p.planId)!.name,
      startDate: p.startDate,
      endDate: p.endDate,
      price: p.price,
      paid,
      due: p.price === null ? null : Math.max(p.price - paid, 0),
      status,
      current: p.startDate === currentStart,
    };
  }

  periodsOf(memberId: string): SubscriptionPeriod[] {
    const member = this.db.members.find((m) => m.id === memberId);
    return this.db.periods
      .filter((p) => p.memberId === memberId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .slice(0, 12)
      .map((p) => this.toPeriod(p, member?.subscription?.startDate ?? null));
  }

  /** Sets the subscription and records the period (same start = same period) + payment. */
  sell(
    memberId: string,
    input: { planId: PlanId; startDate: string; payment?: PaymentInput | null },
    receivedBy: string,
  ): void {
    const member = this.db.members.find((m) => m.id === memberId)!;
    member.subscription = { planId: input.planId, startDate: input.startDate };
    const plan = this.db.plans.find((p) => p.id === input.planId)!;
    const price = plan.price ?? input.payment?.amount ?? null;
    let period = this.db.periods.find(
      (p) => p.memberId === memberId && p.startDate === input.startDate,
    );
    if (period) {
      Object.assign(period, { planId: input.planId, price });
    } else {
      period = {
        id: nextId('per'),
        memberId,
        planId: input.planId,
        startDate: input.startDate,
        endDate: addDays(addMonths(input.startDate, 1), -1),
        price,
      };
      this.db.periods.push(period);
    }
    if (input.payment) {
      this.pay(memberId, period.id, input.payment, receivedBy);
    }
  }

  pay(memberId: string, periodId: string | null, input: PaymentInput, receivedBy: string): Payment {
    const now = new Date();
    const entity = {
      id: nextId('pay'),
      memberId,
      periodId,
      amount: input.amount,
      method: input.method,
      paidAt: now.toISOString(),
      date: toIsoDate(now),
      receivedBy,
      note: input.note ?? '',
    };
    this.db.payments.push(entity);
    return this.toPayment(entity.id);
  }

  toPayment(id: string): Payment {
    const p = this.db.payments.find((x) => x.id === id)!;
    const member = this.db.members.find((m) => m.id === p.memberId)!;
    const period = this.db.periods.find((x) => x.id === p.periodId);
    const planName = period && this.db.plans.find((x) => x.id === period.planId)!.name;
    return {
      id: p.id,
      memberId: p.memberId,
      memberName: `${member.firstName} ${member.lastName}`,
      periodId: p.periodId,
      periodLabel: period
        ? `${planName} · ${formatDayMonth(period.startDate)} – ${formatDayMonth(period.endDate)}`
        : null,
      amount: p.amount,
      method: p.method,
      paidAt: p.paidAt,
      receivedBy: p.receivedBy,
      note: p.note,
    };
  }

  summary(month: string): FinanceSummary {
    const today = toIsoDate(new Date());
    const inMonth = (date: string) => toMonth(date) === month;
    const monthPayments = this.db.payments.filter((p) => inMonth(p.date));
    const firstMonth = addMonthsToMonth(month, -11);
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const m = addMonthsToMonth(firstMonth, i);
      return {
        month: m,
        amount: this.db.payments
          .filter((p) => toMonth(p.date) === m)
          .reduce((s, p) => s + p.amount, 0),
      };
    });
    const summaries = this.db.members.map((m) => this.views.summary(m));
    const started = this.db.periods.filter((p) => p.startDate <= today);
    const unpaid: UnpaidPeriod[] = started
      .map((p) => {
        const m = this.db.members.find((x) => x.id === p.memberId)!;
        return {
          ...this.toPeriod(p, m.subscription?.startDate ?? null),
          memberId: m.id,
          memberName: `${m.firstName} ${m.lastName}`,
          phone: m.phone,
        };
      })
      .filter((p) => p.status === 'unpaid' || p.status === 'partial')
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    const soldThisMonth = this.db.periods.filter((p) => inMonth(p.startDate));
    const activeByPlan = this.db.plans.map((plan) => ({
      planId: plan.id,
      planName: plan.name,
      count: summaries.filter(
        (m) =>
          m.subscription?.planId === plan.id && ['active', 'expiring', 'limit'].includes(m.status),
      ).length,
    }));
    return {
      month,
      revenue: monthPayments.reduce((s, p) => s + p.amount, 0),
      revenuePrevious: monthly.at(-2)?.amount ?? 0,
      byMethod: METHODS.map((method) => ({
        method,
        amount: monthPayments.filter((p) => p.method === method).reduce((s, p) => s + p.amount, 0),
      })),
      monthly,
      outstanding: unpaid.reduce((s, p) => s + (p.due ?? 0), 0),
      unpaid,
      unpricedPeriods: started.filter((p) => p.price === null).length,
      subscriptions: {
        activeByPlan: activeByPlan.filter((p) => p.count > 0),
        soldThisMonth: soldThisMonth.length,
        renewalsThisMonth: soldThisMonth.filter((p) =>
          this.db.periods.some((q) => q.memberId === p.memberId && q.startDate < p.startDate),
        ).length,
        expiringSoon: summaries.filter(
          (m) =>
            m.subscription &&
            m.status !== 'expired' &&
            daysBetween(today, m.subscription.endDate) < 7,
        ).length,
      },
      payments: monthPayments
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
        .map((p) => this.toPayment(p.id)),
    };
  }
}
