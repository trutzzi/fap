import {
  Alert,
  Attendee,
  CheckInRecord,
  Course,
  CourseRef,
  CurrentTraining,
  Dashboard,
  MemberAttendance,
  MemberDetail,
  MemberFilter,
  MemberStatus,
  MemberSummary,
  MembersPage,
  MembersQuery,
  Plan,
  RecentCheckIn,
  SubscriptionUsage,
  TrainingState,
  TrainingsToday,
  WeekSchedule,
} from '../../app/core/api/models';
import {
  WEEKDAYS,
  addDays,
  addMonths,
  addMonthsToMonth,
  daysBetween,
  formatDayMonth,
  isoWeekday,
  minutesNow,
  minutesOfDay,
  toIsoDate,
  toMonth,
} from '../../app/core/util/dates';
import { CheckInEntity, Db, MemberEntity, SlotEntity, normalizeRfid } from './db';

/** A subscription is "expiring" this many days before its last day. */
const EXPIRING_WITHIN_DAYS = 7;
/** Members can check in this many minutes before a training starts. */
const CHECKIN_WINDOW_BEFORE_MIN = 30;

export class Views {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private get now(): Date {
    return this.clock();
  }

  private get today(): string {
    return toIsoDate(this.now);
  }

  // ---- Lookups -------------------------------------------------------------

  courseRef(id: string): CourseRef | null {
    const c = this.db.courses.find((course) => course.id === id);
    return c ? { id: c.id, name: c.name, color: c.color } : null;
  }

  slotLabel(slot: SlotEntity): string {
    return slot.label ?? this.db.courses.find((c) => c.id === slot.courseId)?.name ?? '';
  }

  private checkinsOf(memberId: string): CheckInEntity[] {
    return this.db.checkins.filter((c) => c.memberId === memberId);
  }

  // ---- Members -------------------------------------------------------------

  periodEnd(startDate: string): string {
    return addDays(addMonths(startDate, 1), -1);
  }

  usage(member: MemberEntity): SubscriptionUsage | null {
    const sub = member.subscription;
    if (!sub) return null;
    const plan = this.db.plans.find((p) => p.id === sub.planId)!;
    const endDate = this.periodEnd(sub.startDate);
    const used = this.checkinsOf(member.id).filter(
      (c) => c.date >= sub.startDate && c.date <= endDate,
    ).length;
    return {
      planId: plan.id,
      planName: plan.name,
      sessionLimit: plan.sessionLimit,
      price: plan.price,
      startDate: sub.startDate,
      endDate,
      used,
      remaining: plan.sessionLimit === null ? null : Math.max(plan.sessionLimit - used, 0),
    };
  }

  status(usage: SubscriptionUsage | null): MemberStatus {
    if (!usage) return 'none';
    if (usage.endDate < this.today) return 'expired';
    if (usage.remaining === 0) return 'limit';
    const daysLeft = daysBetween(this.today, usage.endDate);
    if (daysLeft < EXPIRING_WITHIN_DAYS || usage.remaining === 1) return 'expiring';
    return 'active';
  }

  summary(member: MemberEntity): MemberSummary {
    const subscription = this.usage(member);
    return {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      fullName: `${member.firstName} ${member.lastName}`,
      initials: `${member.firstName[0] ?? ''}${member.lastName[0] ?? ''}`.toUpperCase(),
      phone: member.phone,
      email: member.email,
      rfid: member.rfid,
      joinedAt: member.joinedAt,
      photoConsent: member.photoConsent,
      photoUrl: member.photo ? `/api/members/${member.id}/photo?v=${member.photo.updatedAt}` : null,
      courses: member.courseIds.map((id) => this.courseRef(id)).filter((c) => c !== null),
      subscription,
      status: this.status(subscription),
    };
  }

  members(query: MembersQuery): MembersPage {
    const all = this.db.members
      .map((m) => this.summary(m))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ro'));
    const q = query.q?.trim().toLowerCase() ?? '';
    const qDigits = q.replace(/\D/g, '');
    const qRfid = normalizeRfid(q);
    const matchesFilter: Record<MemberFilter, (m: MemberSummary) => boolean> = {
      all: () => true,
      active: (m) => m.status === 'active' || m.status === 'expiring' || m.status === 'limit',
      expiring: (m) => m.status === 'expiring',
      limit: (m) => m.status === 'limit',
      expired: (m) => m.status === 'expired' || m.status === 'none',
      'no-card': (m) => m.rfid === null,
    };
    const filtered = all.filter(
      (m) =>
        matchesFilter[query.filter ?? 'all'](m) &&
        (!query.courseId || m.courses.some((c) => c.id === query.courseId)) &&
        (!q ||
          m.fullName.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (qDigits.length >= 3 && m.phone.replace(/\D/g, '').includes(qDigits)) ||
          (qRfid.length >= 4 && (m.rfid ?? '').includes(qRfid))),
    );
    const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 100);
    const pages = Math.max(Math.ceil(filtered.length / pageSize), 1);
    const page = Math.min(Math.max(query.page ?? 1, 1), pages);
    const activeCount = all.filter(matchesFilter.active).length;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      activeCount,
      inactiveCount: all.length - activeCount,
    };
  }

  /** Check-in history with session numbers within the current subscription period. */
  private history(member: MemberEntity, limit: number): CheckInRecord[] {
    const usage = this.usage(member);
    const inPeriod = (c: CheckInEntity) =>
      !!usage && c.date >= usage.startDate && c.date <= usage.endDate;
    const sorted = this.checkinsOf(member.id).sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    let counter = 0;
    const records = sorted.map((c) => ({
      id: c.id,
      timestamp: c.timestamp,
      trainingLabel: c.trainingLabel,
      method: c.method,
      sessionNumber: inPeriod(c) ? ++counter : null,
      sessionLimit: inPeriod(c) ? (usage?.sessionLimit ?? null) : null,
    }));
    return records.reverse().slice(0, limit);
  }

  memberDetail(member: MemberEntity): Omit<MemberDetail, 'periods'> {
    return { ...this.summary(member), history: this.history(member, 20) };
  }

  attendance(member: MemberEntity, month: string): MemberAttendance {
    const days = new Set(
      this.checkinsOf(member.id)
        .filter((c) => toMonth(c.date) === month)
        .map((c) => Number(c.date.slice(8, 10))),
    );
    return { month, days: [...days].sort((a, b) => a - b) };
  }

  // ---- Courses & plans -----------------------------------------------------

  courses(): Course[] {
    return this.db.courses.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      coach: c.coach,
      coachUserId: c.coachUserId,
      scheduleSummary: this.scheduleSummary(c.id),
      memberCount: this.db.members.filter((m) => m.courseIds.includes(c.id)).length,
    }));
  }

  /** "Luni – Vineri · 20:00", "Marți, Joi · 17:00 / Sâmbătă · 14:00" */
  scheduleSummary(courseId: string): string {
    const byTime = new Map<string, number[]>();
    for (const s of this.db.slots.filter((slot) => slot.courseId === courseId)) {
      byTime.set(s.time, [...(byTime.get(s.time) ?? []), s.weekday]);
    }
    // Groups in week order: "Marți, Joi · 17:00 / Sâmbătă · 14:00".
    return [...byTime.entries()]
      .sort(([, a], [, b]) => Math.min(...a) - Math.min(...b))
      .map(([time, days]) => `${formatWeekdays(days)} · ${time}`)
      .join(' / ');
  }

  plans(): Plan[] {
    return this.db.plans.map((p) => ({
      ...p,
      memberCount: this.db.members.filter((m) => m.subscription?.planId === p.id).length,
    }));
  }

  // ---- Schedule ------------------------------------------------------------

  trainingState(date: string, slot: SlotEntity): TrainingState {
    if (date !== this.today) return date < this.today ? 'done' : 'upcoming';
    const nowMin = minutesNow(this.now);
    const start = minutesOfDay(slot.time);
    if (nowMin < start) return 'upcoming';
    return nowMin < start + slot.durationMin ? 'live' : 'done';
  }

  private attendanceAt(slotId: string, date: string): number {
    return this.db.checkins.filter((c) => c.slotId === slotId && c.date === date).length;
  }

  weekSchedule(weekStart: string): WeekSchedule {
    const days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      const entries = this.db.slots
        .filter((s) => s.weekday === i + 1)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((slot) => {
          const course = this.db.courses.find((c) => c.id === slot.courseId)!;
          const state = this.trainingState(date, slot);
          const previous = [1, 2, 3, 4].map((w) =>
            this.attendanceAt(slot.id, addDays(date, -7 * w)),
          );
          const total = previous.reduce((sum, n) => sum + n, 0);
          return {
            slot: { ...slot },
            name: this.slotLabel(slot),
            color: course.color,
            coach: course.coach,
            state,
            attendance: state === 'upcoming' ? null : this.attendanceAt(slot.id, date),
            average: total > 0 ? Math.round(total / previous.length) : null,
          };
        });
      return { date, weekday: i + 1, isToday: date === this.today, entries };
    });
    return { weekStart, days };
  }

  /**
   * The training a check-in made now belongs to: one that is running or starts within
   * the check-in window, preferring the member's own courses.
   */
  currentSlot(courseIds: string[] = []): SlotEntity | null {
    const nowMin = minutesNow(this.now);
    const candidates = this.db.slots
      .filter((s) => s.weekday === isoWeekday(this.today))
      .filter((s) => {
        const start = minutesOfDay(s.time);
        return nowMin >= start - CHECKIN_WINDOW_BEFORE_MIN && nowMin < start + s.durationMin;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
    return candidates.find((s) => courseIds.includes(s.courseId)) ?? candidates.at(-1) ?? null;
  }

  currentTraining(): CurrentTraining | null {
    const slot = this.currentSlot();
    if (!slot) return null;
    const course = this.db.courses.find((c) => c.id === slot.courseId);
    return {
      slotId: slot.id,
      label: this.slotLabel(slot),
      time: slot.time,
      coach: course?.coach ?? '',
    };
  }

  // ---- Dashboard -----------------------------------------------------------

  /** Same rules as the back-end's `trainings-today.ts`. */
  trainingsToday(coachUserId?: string): TrainingsToday {
    const today = this.today;
    const nowMin = minutesNow(this.now);
    const label = (m: MemberSummary) => {
      const sub = m.subscription;
      if (!sub) return 'Fără abonament';
      if (m.status === 'expired') return 'Abonament expirat';
      if (sub.remaining === null) return 'Nelimitat';
      if (sub.remaining === 0) return 'Nicio ședință rămasă';
      return sub.remaining === 1 ? '1 ședință rămasă' : `${sub.remaining} ședințe rămase`;
    };
    const attendee = (memberId: string, timestamp: string, refused: Attendee['refused']) => {
      const entity = this.db.members.find((x) => x.id === memberId);
      if (!entity) return [];
      const m = this.summary(entity);
      return [
        {
          memberId,
          fullName: m.fullName,
          initials: m.initials,
          photoUrl: m.photoUrl,
          timestamp,
          refused,
          status: m.status,
          remaining: m.subscription?.remaining ?? null,
          usageLabel: label(m),
        } satisfies Attendee,
      ];
    };
    const attendeesOf = (slotId: string | null): Attendee[] => {
      const admitted = this.db.checkins
        .filter((c) => c.date === today && c.slotId === slotId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const admittedIds = new Set(admitted.map((c) => c.memberId));
      return [
        ...admitted.flatMap((c) => attendee(c.memberId, c.timestamp, null)),
        ...this.db.refusedScans
          .filter((r) => r.date === today && r.slotId === slotId && !admittedIds.has(r.memberId))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .flatMap((r) => attendee(r.memberId, r.timestamp, r.reason)),
      ];
    };
    const trainings = this.db.slots
      .filter((s) => s.weekday === isoWeekday(today))
      .filter(
        (s) =>
          !coachUserId ||
          this.db.courses.find((c) => c.id === s.courseId)?.coachUserId === coachUserId,
      )
      .sort((a, b) => a.time.localeCompare(b.time))
      .map((slot) => {
        const course = this.db.courses.find((c) => c.id === slot.courseId)!;
        const attendees = attendeesOf(slot.id);
        return {
          slotId: slot.id,
          time: slot.time,
          name: this.slotLabel(slot),
          coach: course.coach,
          color: course.color,
          capacity: slot.capacity,
          checkins: attendees.filter((a) => a.refused === null).length,
          state: this.trainingState(today, slot),
          startsInMin: minutesOfDay(slot.time) - nowMin,
          attendees,
        };
      });
    return { date: today, trainings, openGym: coachUserId ? [] : attendeesOf(null) };
  }

  dashboard(): Dashboard {
    const today = this.today;
    const month = toMonth(today);
    const previousMonth = addMonthsToMonth(month, -1);
    const summaries = this.db.members.map((m) => this.summary(m));
    const countOn = (date: string) => this.db.checkins.filter((c) => c.date === date).length;
    const nowMin = minutesNow(this.now);

    const todays = this.trainingsToday();

    const week = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i - 6);
      return { date, count: countOn(date) };
    });

    // Busiest training of the last 7 days, by total attendance.
    const lastWeek = this.db.checkins.filter((c) => c.date > addDays(today, -7) && c.slotId);
    const perSlot = new Map<string, number>();
    for (const c of lastWeek) perSlot.set(c.slotId!, (perSlot.get(c.slotId!) ?? 0) + 1);
    const busiestId = [...perSlot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const busiest = this.db.slots.find((s) => s.id === busiestId);

    const usageLabel = (memberId: string, c: CheckInEntity) => {
      const member = this.db.members.find((m) => m.id === memberId)!;
      const record = this.history(member, Infinity).find((h) => h.id === c.id);
      if (member.subscription?.planId === 'unlimited') return { label: 'Nelimitat', warn: false };
      if (!record?.sessionNumber || !record.sessionLimit) return { label: '—', warn: false };
      return {
        label: `${record.sessionNumber} / ${record.sessionLimit}`,
        warn: record.sessionNumber >= record.sessionLimit - 1,
      };
    };

    const recentCheckins: RecentCheckIn[] = [...this.db.checkins]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 6)
      .map((c) => {
        const member = summaries.find((m) => m.id === c.memberId)!;
        const { label, warn } = usageLabel(c.memberId, c);
        return {
          id: c.id,
          memberId: member.id,
          initials: member.initials,
          fullName: member.fullName,
          photoUrl: member.photoUrl,
          trainingLabel: c.trainingLabel,
          timestamp: c.timestamp,
          usageLabel: label,
          warn,
        };
      });

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
        .filter((m) => m.subscription && m.status !== 'expired' && m.status !== 'limit')
        .filter((m) => daysBetween(today, m.subscription!.endDate) < EXPIRING_WITHIN_DAYS)
        .sort((a, b) => a.subscription!.endDate.localeCompare(b.subscription!.endDate))
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

    return {
      activeMembers: summaries.filter((m) => ['active', 'expiring', 'limit'].includes(m.status))
        .length,
      newMembersThisMonth: this.db.members.filter((m) => toMonth(m.joinedAt) === month).length,
      checkinsToday: countOn(today),
      checkinsThisMonth: this.db.checkins.filter((c) => toMonth(c.date) === month).length,
      checkinsLastMonth: this.db.checkins.filter((c) => toMonth(c.date) === previousMonth).length,
      expiringSoon: summaries.filter(
        (m) =>
          m.subscription &&
          m.status !== 'expired' &&
          daysBetween(today, m.subscription.endDate) < EXPIRING_WITHIN_DAYS,
      ).length,
      today: todays.trainings,
      openGym: todays.openGym,
      week,
      weekAverage: Math.round(week.reduce((sum, d) => sum + d.count, 0) / week.length),
      busiestTraining: busiest ? `${this.slotLabel(busiest)} ${busiest.time}` : null,
      recentCheckins,
      alerts,
    };
  }
}

/** [1,2,3,4,5] → "Luni – Vineri"; [2,4] → "Marți, Joi" */
function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length >= 3 && consecutive) {
    return `${WEEKDAYS[sorted[0] - 1]} – ${WEEKDAYS[sorted.at(-1)! - 1]}`;
  }
  return sorted.map((d) => WEEKDAYS[d - 1]).join(', ');
}
