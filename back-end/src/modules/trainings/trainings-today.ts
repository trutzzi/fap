import type {
  Attendee,
  MemberSummary,
  RefusalReason,
  TodayTraining,
  TrainingsToday,
} from '../../contract/models.js';
import { toDbDate, type Db } from '../../db.js';
import { trainingState } from '../../domain/schedule.js';
import { isoWeekday, minutesNow, minutesOfDay, toIsoDate } from '../../lib/dates.js';
import { loadSummaries } from '../members/member-queries.js';

const REASONS: Record<'limit' | 'expired' | 'no_subscription', RefusalReason> = {
  limit: 'limit',
  expired: 'expired',
  no_subscription: 'no-subscription',
};

/** "4 ședințe rămase", "1 ședință rămasă", "Nelimitat", "Fără abonament"… */
export function usageLabel(member: MemberSummary): string {
  const sub = member.subscription;
  if (!sub) return 'Fără abonament';
  if (member.status === 'expired') return 'Abonament expirat';
  if (sub.remaining === null) return 'Nelimitat';
  if (sub.remaining === 0) return 'Nicio ședință rămasă';
  return sub.remaining === 1 ? '1 ședință rămasă' : `${sub.remaining} ședințe rămase`;
}

function attendee(member: MemberSummary, timestamp: Date, refused: RefusalReason | null): Attendee {
  return {
    memberId: member.id,
    fullName: member.fullName,
    initials: member.initials,
    photoUrl: member.photoUrl,
    timestamp: timestamp.toISOString(),
    refused,
    status: member.status,
    remaining: member.subscription?.remaining ?? null,
    usageLabel: usageLabel(member),
  };
}

/**
 * Today's trainings with their attendees: admitted members by check-in time, then refused
 * scans (only for members who were not admitted to that training afterwards).
 * `coachUserId` restricts the result to that coach's courses and hides open-gym visits.
 */
export async function trainingsToday(
  db: Db,
  now: Date,
  scope: { coachUserId?: string } = {},
): Promise<TrainingsToday> {
  const today = toIsoDate(now);
  const date = toDbDate(today);
  const slotFilter = scope.coachUserId ? { course: { coachUserId: scope.coachUserId } } : {};

  const [slots, checkIns, refused] = await Promise.all([
    db.trainingSlot.findMany({
      where: { weekday: isoWeekday(today), ...slotFilter },
      include: { course: true },
      orderBy: { time: 'asc' },
    }),
    db.checkIn.findMany({ where: { date }, orderBy: { timestamp: 'asc' } }),
    db.refusedScan.findMany({ where: { date }, orderBy: { timestamp: 'asc' } }),
  ]);

  const memberIds = [...new Set([...checkIns, ...refused].map((c) => c.memberId))];
  const members = new Map(
    (await loadSummaries(db, today, { id: { in: memberIds } })).map((m) => [m.id, m]),
  );

  const attendeesOf = (slotId: string | null): Attendee[] => {
    const admitted = checkIns.filter((c) => c.slotId === slotId);
    const admittedIds = new Set(admitted.map((c) => c.memberId));
    return [
      ...admitted.flatMap((c) => {
        const m = members.get(c.memberId);
        return m ? [attendee(m, c.timestamp, null)] : [];
      }),
      ...refused
        .filter((r) => r.slotId === slotId && !admittedIds.has(r.memberId))
        .flatMap((r) => {
          const m = members.get(r.memberId);
          return m ? [attendee(m, r.timestamp, REASONS[r.reason])] : [];
        }),
    ];
  };

  const nowMin = minutesNow(now);
  const trainings: TodayTraining[] = slots.map(({ course, ...slot }) => {
    const attendees = attendeesOf(slot.id);
    return {
      slotId: slot.id,
      time: slot.time,
      name: slot.label ?? course.name,
      coach: course.coach,
      color: course.color,
      capacity: slot.capacity,
      checkins: attendees.filter((a) => a.refused === null).length,
      state: trainingState(today, slot, now),
      startsInMin: minutesOfDay(slot.time) - nowMin,
      attendees,
    };
  });

  return { date: today, trainings, openGym: scope.coachUserId ? [] : attendeesOf(null) };
}
