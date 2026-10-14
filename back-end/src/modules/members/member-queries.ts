import type { CheckInRecord, MemberSummary } from '../../contract/models.js';
import { fromDbDate, toDbDate, type DbClient } from '../../db.js';
import { initials, memberStatus, usage } from '../../domain/membership.js';
import { Prisma } from '../../generated/prisma/client.js';

export const memberInclude = {
  courses: { include: { course: true } },
  subscription: { include: { plan: true } },
  photo: { select: { updatedAt: true } },
} satisfies Prisma.MemberInclude;

/** Same-origin photo URL; the version changes whenever the photo is replaced. */
export function photoUrl(memberId: string, photo: { updatedAt: Date } | null): string | null {
  return photo
    ? `/api/members/${encodeURIComponent(memberId)}/photo?v=${photo.updatedAt.getTime()}`
    : null;
}

export type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;

/**
 * Sessions used in each member's current subscription period, in one query.
 * Omitting `memberIds` counts for every member.
 */
export async function usedSessions(
  db: DbClient,
  memberIds?: string[],
): Promise<Map<string, number>> {
  if (memberIds?.length === 0) return new Map();
  const filter = memberIds
    ? Prisma.sql`AND c.member_id IN (${Prisma.join(memberIds)})`
    : Prisma.empty;
  const rows = await db.$queryRaw<{ member_id: string; used: number }[]>`
    SELECT c.member_id, COUNT(*)::int AS used
    FROM check_ins c
    JOIN subscriptions s ON s.member_id = c.member_id
    WHERE c.date BETWEEN s.start_date AND s.end_date ${filter}
    GROUP BY c.member_id`;
  return new Map(rows.map((r) => [r.member_id, r.used]));
}

export function toSummary(row: MemberRow, used: number, today: string): MemberSummary {
  const sub = row.subscription;
  const subscription = sub
    ? usage({
        planId: sub.planId,
        planName: sub.plan.name,
        sessionLimit: sub.plan.sessionLimit,
        price: sub.plan.price,
        startDate: fromDbDate(sub.startDate),
        endDate: fromDbDate(sub.endDate),
        used,
      })
    : null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`,
    initials: initials(row.firstName, row.lastName),
    phone: row.phone,
    email: row.email,
    rfid: row.rfid,
    joinedAt: fromDbDate(row.joinedAt),
    photoConsent: row.photoConsent,
    photoUrl: photoUrl(row.id, row.photo),
    courses: row.courses
      .map(({ course }) => ({ id: course.id, name: course.name, color: course.color }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ro')),
    subscription,
    status: memberStatus(subscription, today),
  };
}

export async function loadSummaries(
  db: DbClient,
  today: string,
  where?: Prisma.MemberWhereInput,
): Promise<MemberSummary[]> {
  const rows = await db.member.findMany({
    where,
    include: memberInclude,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  const used = await usedSessions(db, where ? rows.map((r) => r.id) : undefined);
  return rows
    .map((r) => toSummary(r, used.get(r.id) ?? 0, today))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ro'));
}

export async function loadSummary(
  db: DbClient,
  id: string,
  today: string,
): Promise<MemberSummary | null> {
  return (await loadSummaries(db, today, { id }))[0] ?? null;
}

/**
 * Most recent check-ins, numbered within the current subscription period
 * ("8 / 12") for limited plans.
 */
export async function checkInHistory(
  db: DbClient,
  member: MemberSummary,
  take: number,
): Promise<CheckInRecord[]> {
  const sub = member.subscription;
  const [recent, inPeriod] = await Promise.all([
    db.checkIn.findMany({ where: { memberId: member.id }, orderBy: { timestamp: 'desc' }, take }),
    sub
      ? db.checkIn.findMany({
          where: {
            memberId: member.id,
            date: { gte: toDbDate(sub.startDate), lte: toDbDate(sub.endDate) },
          },
          orderBy: { timestamp: 'asc' },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const position = new Map(inPeriod.map((c, i) => [c.id, i + 1]));
  return recent.map((c) => ({
    id: c.id,
    timestamp: c.timestamp.toISOString(),
    trainingLabel: c.trainingLabel,
    method: c.method,
    sessionNumber: position.get(c.id) ?? null,
    sessionLimit: position.has(c.id) ? (sub?.sessionLimit ?? null) : null,
  }));
}
