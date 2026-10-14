import type {
  Payment,
  PaymentInput,
  PeriodPaymentStatus,
  PlanId,
  SubscriptionPeriod,
} from '../../contract/models.js';
import { fromDbDate, toDbDate, type DbClient } from '../../db.js';
import { periodEnd } from '../../domain/membership.js';
import { formatDayMonth, toIsoDate } from '../../lib/dates.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const periodInclude = {
  plan: { select: { name: true } },
  payments: { select: { amount: true } },
} satisfies Prisma.SubscriptionPeriodInclude;

type PeriodRow = Prisma.SubscriptionPeriodGetPayload<{ include: typeof periodInclude }>;

export function paymentStatus(price: number | null, paid: number): PeriodPaymentStatus {
  if (price === null) return 'no-price';
  if (paid >= price) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
}

export function toPeriod(row: PeriodRow, currentStart: string | null): SubscriptionPeriod {
  const paid = row.payments.reduce((sum, p) => sum + p.amount, 0);
  const startDate = fromDbDate(row.startDate);
  return {
    id: row.id,
    planId: row.planId,
    planName: row.plan.name,
    startDate,
    endDate: fromDbDate(row.endDate),
    price: row.price,
    paid,
    due: row.price === null ? null : Math.max(row.price - paid, 0),
    status: paymentStatus(row.price, paid),
    current: startDate === currentStart,
  };
}

export function periodLabel(planName: string, start: Date, end: Date): string {
  return `${planName} · ${formatDayMonth(fromDbDate(start))} – ${formatDayMonth(fromDbDate(end))}`;
}

export const paymentInclude = {
  member: { select: { firstName: true, lastName: true } },
  receivedBy: { select: { name: true } },
  period: { select: { startDate: true, endDate: true, plan: { select: { name: true } } } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: `${row.member.firstName} ${row.member.lastName}`,
    periodId: row.periodId,
    periodLabel: row.period
      ? periodLabel(row.period.plan.name, row.period.startDate, row.period.endDate)
      : null,
    amount: row.amount,
    method: row.method,
    paidAt: row.paidAt.toISOString(),
    receivedBy: row.receivedBy?.name ?? null,
    note: row.note,
  };
}

/**
 * Sets the member's current subscription and records the sold period (same start date →
 * same period, e.g. a plan change), plus an optional payment. Call inside a transaction.
 */
export async function sellSubscription(
  tx: DbClient,
  input: {
    memberId: string;
    planId: PlanId;
    startDate: string;
    payment?: PaymentInput | null;
    userId: string | null;
    now: Date;
  },
): Promise<void> {
  const { memberId, planId, startDate, payment, userId, now } = input;
  const period = {
    planId,
    startDate: toDbDate(startDate),
    endDate: toDbDate(periodEnd(startDate)),
  };
  await tx.subscription.upsert({
    where: { memberId },
    create: { memberId, ...period },
    update: period,
  });
  const plan = await tx.plan.findUniqueOrThrow({ where: { id: planId }, select: { price: true } });
  const price = plan.price ?? payment?.amount ?? null;
  const saved = await tx.subscriptionPeriod.upsert({
    where: { memberId_startDate: { memberId, startDate: period.startDate } },
    create: { memberId, ...period, price, createdById: userId },
    update: { planId, endDate: period.endDate, price },
  });
  if (payment) {
    await tx.payment.create({
      data: {
        memberId,
        periodId: saved.id,
        amount: payment.amount,
        method: payment.method,
        note: payment.note ?? '',
        paidAt: now,
        date: toDbDate(toIsoDate(now)),
        receivedById: userId,
      },
    });
  }
}
