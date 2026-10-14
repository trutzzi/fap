/**
 * API contract shared by the Angular app and the mock API in `src/server/mock-api`.
 * Dates are local `YYYY-MM-DD` strings; timestamps are ISO 8601 strings.
 */

export type PlanId = 'sessions12' | 'unlimited';

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  /** `null` means unlimited sessions. */
  sessionLimit: number | null;
  /** Monthly price in lei; `null` until configured. */
  price: number | null;
  memberCount: number;
}

/** `sessionLimit` is only editable on the limited plan; it stays `null` for `unlimited`. */
export interface PlanInput {
  name: string;
  description: string;
  sessionLimit: number | null;
  price: number | null;
}

// ---- Auth & club ------------------------------------------------------------

/**
 * `admin`: everything. `reception`: members, subscriptions, cards and check-ins.
 * `coach`: read-only — today's attendees of their own courses, the schedule, check-in.
 */
export type Role = 'admin' | 'reception' | 'coach';

/** A staff account as listed for pickers (e.g. a course's coach). */
export interface StaffRef {
  id: string;
  name: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface Club {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** IANA timezone, e.g. `Europe/Bucharest`. */
  timezone: string;
}

export type ClubInput = Club;

export interface CourseRef {
  id: string;
  name: string;
  color: string;
}

export interface Course extends CourseRef {
  coach: string;
  /** Coach account that sees this course's attendees (`null`: none linked). */
  coachUserId: string | null;
  /** Human readable weekly schedule, e.g. "Luni – Vineri · 20:00". */
  scheduleSummary: string;
  memberCount: number;
}

export interface CourseInput {
  name: string;
  color: string;
  coach: string;
  coachUserId: string | null;
}

/** A recurring weekly training. `weekday`: 1 = Monday … 7 = Sunday. */
export interface TrainingSlot {
  id: string;
  courseId: string;
  weekday: number;
  /** `HH:mm` */
  time: string;
  durationMin: number;
  capacity: number;
  /** Overrides the course name in the schedule, e.g. "Karate · Începători". */
  label: string | null;
}

export type TrainingSlotInput = Omit<TrainingSlot, 'id'>;

export type MemberStatus = 'active' | 'expiring' | 'limit' | 'expired' | 'none';
export type MemberFilter = 'all' | 'active' | 'expiring' | 'limit' | 'expired' | 'no-card';

export interface SubscriptionUsage {
  planId: PlanId;
  planName: string;
  sessionLimit: number | null;
  price: number | null;
  startDate: string;
  endDate: string;
  used: number;
  /** `null` for unlimited plans. */
  remaining: number | null;
}

export interface MemberSummary {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  initials: string;
  phone: string;
  email: string;
  rfid: string | null;
  joinedAt: string;
  /** GDPR consent to keep a photo (a parent's, for minors). */
  photoConsent: boolean;
  /** Same-origin URL of the photo (changes when it is replaced), or `null`. */
  photoUrl: string | null;
  courses: CourseRef[];
  subscription: SubscriptionUsage | null;
  status: MemberStatus;
}

export type CheckInMethod = 'rfid' | 'manual';

export interface CheckInRecord {
  id: string;
  timestamp: string;
  trainingLabel: string | null;
  method: CheckInMethod;
  /** Session number within the subscription period, for limited plans. */
  sessionNumber: number | null;
  sessionLimit: number | null;
}

export interface MemberDetail extends MemberSummary {
  history: CheckInRecord[];
  /** Most recent first. */
  periods: SubscriptionPeriod[];
}

export interface MemberAttendance {
  /** `YYYY-MM` */
  month: string;
  /** Days of the month with at least one check-in. */
  days: number[];
}

export interface MemberInput {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  courseIds: string[];
  rfid: string | null;
  /** Withdrawing consent deletes the stored photo. */
  photoConsent: boolean;
}

export interface NewMemberInput extends MemberInput {
  subscription: SubscriptionInput | null;
}

export interface SubscriptionInput {
  planId: PlanId;
  startDate: string;
  /** Record a payment for this period right away (optional). */
  payment?: PaymentInput | null;
}

// ---- Payments & subscription history --------------------------------------------

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export interface PaymentInput {
  /** Whole lei. */
  amount: number;
  method: PaymentMethod;
  note?: string;
}

export interface NewPaymentInput extends PaymentInput {
  memberId: string;
  /** The subscription period this pays for; `null` for anything else. */
  periodId: string | null;
}

export type PeriodPaymentStatus = 'paid' | 'partial' | 'unpaid' | 'no-price';

/** One sold subscription period with what has been paid for it. */
export interface SubscriptionPeriod {
  id: string;
  planId: PlanId;
  planName: string;
  startDate: string;
  endDate: string;
  price: number | null;
  paid: number;
  /** `price - paid`, never negative; `null` without a price. */
  due: number | null;
  status: PeriodPaymentStatus;
  /** The period the member's current subscription refers to. */
  current: boolean;
}

export interface Payment {
  id: string;
  memberId: string;
  memberName: string;
  periodId: string | null;
  /** "12 ședințe / lună · 1 oct – 31 oct" */
  periodLabel: string | null;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  receivedBy: string | null;
  note: string;
}

export interface UnpaidPeriod extends SubscriptionPeriod {
  memberId: string;
  memberName: string;
  phone: string;
}

export interface FinanceSummary {
  /** `YYYY-MM` */
  month: string;
  revenue: number;
  revenuePrevious: number;
  byMethod: { method: PaymentMethod; amount: number }[];
  /** Last 12 months, oldest first. */
  monthly: { month: string; amount: number }[];
  /** Sum still due on periods that have started. */
  outstanding: number;
  unpaid: UnpaidPeriod[];
  /** Periods without a price (plan prices not set yet). */
  unpricedPeriods: number;
  subscriptions: {
    activeByPlan: { planId: PlanId; planName: string; count: number }[];
    soldThisMonth: number;
    renewalsThisMonth: number;
    expiringSoon: number;
  };
  payments: Payment[];
}

export interface RfidInput {
  rfid: string | null;
}

export interface MembersQuery {
  q?: string;
  filter?: MemberFilter;
  courseId?: string;
  page?: number;
  pageSize?: number;
}

export interface MembersPage {
  items: MemberSummary[];
  total: number;
  page: number;
  pageSize: number;
  activeCount: number;
  inactiveCount: number;
}

export type TrainingState = 'done' | 'live' | 'upcoming';

/** Why a scan was refused (recorded for the coach; never counts as a session). */
export type RefusalReason = 'limit' | 'expired' | 'no-subscription';

/** A member who checked in to, or was refused at, a training today. */
export interface Attendee {
  memberId: string;
  fullName: string;
  initials: string;
  photoUrl: string | null;
  /** Time of the check-in, or of the last refused scan. */
  timestamp: string;
  /** `null` when admitted. */
  refused: RefusalReason | null;
  /** Membership state right now. */
  status: MemberStatus;
  /** Sessions left on a limited plan; `null` for unlimited or no subscription. */
  remaining: number | null;
  /** "4 rămase", "Nelimitat", "Fără abonament"… */
  usageLabel: string;
}

export interface TodayTraining {
  slotId: string;
  time: string;
  name: string;
  coach: string;
  color: string;
  capacity: number;
  checkins: number;
  state: TrainingState;
  startsInMin: number;
  /** Admitted first (by time), then refused scans. */
  attendees: Attendee[];
}

/** Today's trainings visible to the signed-in user (a coach sees only their own courses). */
export interface TrainingsToday {
  date: string;
  trainings: TodayTraining[];
  /** Check-ins with no training running ("acces liber"); empty for coaches. */
  openGym: Attendee[];
}

export interface DayAttendance {
  date: string;
  count: number;
}

export interface RecentCheckIn {
  id: string;
  memberId: string;
  initials: string;
  fullName: string;
  photoUrl: string | null;
  trainingLabel: string | null;
  timestamp: string;
  /** "8 / 12" or "Nelimitat" */
  usageLabel: string;
  warn: boolean;
}

export type AlertKind = 'limit' | 'expiring' | 'no-card';

export interface Alert {
  kind: AlertKind;
  memberId: string | null;
  title: string;
  detail: string;
}

export interface Dashboard {
  activeMembers: number;
  newMembersThisMonth: number;
  checkinsToday: number;
  checkinsThisMonth: number;
  checkinsLastMonth: number;
  expiringSoon: number;
  today: TodayTraining[];
  /** Check-ins today with no training running ("acces liber"). */
  openGym: Attendee[];
  week: DayAttendance[];
  weekAverage: number;
  busiestTraining: string | null;
  recentCheckins: RecentCheckIn[];
  alerts: Alert[];
}

export interface ScheduleEntry {
  slot: TrainingSlot;
  name: string;
  color: string;
  coach: string;
  state: TrainingState;
  /** Check-ins for this occurrence (past and live trainings). */
  attendance: number | null;
  /** Average attendance over the previous 4 weeks. */
  average: number | null;
}

export interface ScheduleDay {
  date: string;
  weekday: number;
  isToday: boolean;
  entries: ScheduleEntry[];
}

export interface WeekSchedule {
  weekStart: string;
  days: ScheduleDay[];
}

export interface CurrentTraining {
  slotId: string;
  label: string;
  time: string;
  coach: string;
}

export interface KioskStatus {
  current: CurrentTraining | null;
}

export interface CheckInRequest {
  rfid?: string;
  memberId?: string;
}

export type CheckInOutcome =
  'allowed' | 'already-checked-in' | 'limit' | 'expired' | 'no-subscription' | 'unknown-card';

export interface CheckInResult {
  outcome: CheckInOutcome;
  member: MemberSummary | null;
  trainingLabel: string | null;
}

export interface ApiError {
  message: string;
}

// ---- Reports ---------------------------------------------------------------------

export interface CourseReport {
  /** `null`: check-ins with no training (open gym) or of a deleted training. */
  courseId: string | null;
  name: string;
  color: string;
  checkins: number;
  /** Distinct members who came. */
  members: number;
  /** Trainings of this course held in the month (up to today). */
  trainings: number;
  /** Average check-ins per training held; `null` without trainings. */
  average: number | null;
}

export interface InactiveMember {
  memberId: string;
  fullName: string;
  phone: string;
  planName: string;
  /** `null` when the member never checked in. */
  lastCheckIn: string | null;
  daysSince: number | null;
}

export interface ReportsSummary {
  /** `YYYY-MM` */
  month: string;
  totals: { checkins: number; members: number; refused: number };
  byCourse: CourseReport[];
  /** Check-ins per weekday (1 = Monday) and hour (0–23), only non-zero cells. */
  heatmap: { weekday: number; hour: number; count: number }[];
  /** Valid subscription but no check-in for at least `inactiveDays` days. */
  inactive: InactiveMember[];
  inactiveDays: number;
  topMembers: { memberId: string; fullName: string; checkins: number }[];
}
