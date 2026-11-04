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

/** Minimum length of a staff password (the API enforces it too). */
export const STAFF_PASSWORD_MIN_LENGTH = 10;

/** `PUT /api/auth/password`: the signed-in staff user changes their own password. */
export interface OwnPasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** A staff account in Administrare › Conturi (admin only). */
export interface StaffAccount {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Deactivated accounts cannot sign in (`npm run user:deactivate`). */
  active: boolean;
  lastLoginAt: string | null;
}

/** `POST /api/users` (admin): a new staff account; its email must be unused. */
export interface NewStaffAccountInput {
  name: string;
  email: string;
  role: Role;
  /** At least `STAFF_PASSWORD_MIN_LENGTH` characters; the person can change it later. */
  password: string;
}

/** `PUT /api/users/:id/password` (admin): sets an account's password and signs it out. */
export interface SetPasswordInput {
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
  /**
   * Text new member PINs by SMS (needs SMSLink configured on the server). Off: reception
   * is shown the PIN and hands it over in person.
   */
  smsEnabled: boolean;
  /** Volume of the kiosk's check-in sounds, 0–100 (0 = silent); each tablet can still mute. */
  kioskVolume: number;
  /**
   * Text each member once, 3 days before their subscription ends (10:00–20:00; needs
   * SMSLink configured on the server).
   */
  expiryReminderSms: boolean;
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
  /** A member portal PIN has been issued (see `MemberAccessResult`). */
  hasAccount: boolean;
}

export type CheckInMethod = 'rfid' | 'qr' | 'manual';

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

/** `POST /members` also issues the member's portal PIN and texts it to them. */
export interface CreatedMember extends MemberSummary {
  access: MemberAccessResult;
}

/**
 * What happened to the PIN SMS: `sent` (accepted by the provider), `disabled` (SMS sending
 * is off in the club settings) or `failed` (provider error or not configured; see the logs).
 */
export type PinSmsOutcome = 'sent' | 'disabled' | 'failed';

/** Result of issuing a new member portal PIN (`POST /members/:id/access`). */
export interface MemberAccessResult {
  sms: PinSmsOutcome;
  /** The member's phone, as stored (where the SMS went, or the login for the PIN). */
  phone: string;
  /** The generated 6-digit PIN, only when no SMS was sent: reception hands it over. */
  temporaryPin: string | null;
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

/** `PUT /api/periods/:id` (admin): corrects the agreed price of a sold period. */
export interface PeriodPriceInput {
  /** Whole lei; `null` clears it ("no price"). */
  price: number | null;
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

/** `POST /members/bulk-delete` (admin): permanently deletes members and their history. */
export interface BulkDeleteInput {
  memberIds: string[];
}

export interface BulkDeleteResult {
  deleted: number;
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

/** Exactly one of: a card code, a member portal QR code (`MEMBER_QR_PREFIX…`), a member id. */
export interface CheckInRequest {
  rfid?: string;
  qr?: string;
  memberId?: string;
}

export type CheckInOutcome =
  | 'allowed'
  | 'already-checked-in'
  | 'limit'
  | 'expired'
  | 'no-subscription'
  | 'unknown-card'
  /** The QR code is expired (it rotates every 30 s), forged or of a deleted member. */
  | 'invalid-qr';

export interface CheckInResult {
  outcome: CheckInOutcome;
  member: MemberSummary | null;
  trainingLabel: string | null;
}

export interface ApiError {
  message: string;
}

// ---- Member portal (`/api/account`, cookie `fa_member`, separate from staff sessions) ----

/** Every member QR code starts with this, which tells the kiosk it is not an RFID card code. */
export const MEMBER_QR_PREFIX = 'FA1.';

export interface MemberLoginInput {
  /** Any common format: `0722 123 456`, `+40722123456`… */
  phone: string;
  /** 4–6 digits: generated (6) and texted, or chosen by the member. */
  pin: string;
}

/** What a signed-in member sees about themselves. */
export interface MemberAccount {
  id: string;
  firstName: string;
  fullName: string;
  initials: string;
  phone: string;
  courses: CourseRef[];
  subscription: SubscriptionUsage | null;
  status: MemberStatus;
  /** Most recent first. */
  history: CheckInRecord[];
  /** Announcements the member hasn't opened yet. */
  unreadAnnouncements: number;
  /** Notifications (check-ins, reminders, announcements) not seen yet. */
  unreadNotifications: number;
  joinedAt: string;
  stats: MemberStats;
}

/** Attendance figures for the member portal ("Statisticile tale"). */
export interface MemberStats {
  /** All check-ins ever. */
  total: number;
  thisMonth: number;
  lastMonth: number;
  /** Sum of the trainings' durations (60 min when unknown), rounded. */
  trainingHours: number;
  /** Most attended training by name; `null` without check-ins at a training. */
  favoriteTraining: { label: string; count: number } | null;
  /** 1 = Monday … 7 = Sunday; `null` without check-ins. */
  favoriteWeekday: number | null;
  /** Consecutive weeks with at least one check-in, up to this week (or last week). */
  currentStreakWeeks: number;
  longestStreakWeeks: number;
  /** The last 8 weeks, oldest first. */
  weeks: { weekStart: string; count: number }[];
}

/** The member's current check-in QR code; fetch a new one before `expiresAt`. */
export interface MemberQrCode {
  /** The text to encode, `MEMBER_QR_PREFIX` + member id + time step + signature. */
  token: string;
  /** ISO timestamp after which the kiosk refuses it. */
  expiresAt: string;
  /** Suggested refresh interval in seconds. */
  refreshSeconds: number;
}

export interface PinChangeInput {
  currentPin: string;
  /** 4–6 digits. */
  newPin: string;
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

// ---- Logs (admin only) ----

export interface UptimeTarget {
  name: string;
  /** `null` before the first check. */
  up: boolean | null;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  lastError: string | null;
  /** Share of successful checks, 0–100 with one decimal; `null` without checks. */
  uptime24h: number | null;
  uptime7d: number | null;
}

/** Consecutive failed checks of one target. */
export interface UptimeIncident {
  target: string;
  from: string;
  to: string;
  checks: number;
  error: string | null;
}

export interface ErrorLogEntry {
  id: string;
  createdAt: string;
  source: string;
  message: string;
  path: string | null;
}

export interface LogsSummary {
  targets: UptimeTarget[];
  incidents: UptimeIncident[];
  errors: ErrorLogEntry[];
}

// ---- Announcements (staff → members, shown in the member portal) ----

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 1000;

/**
 * Who receives an announcement: every member, members with a valid subscription
 * (`active`, `expiring` or `limit`), the members of a course, or hand-picked members.
 */
export type AnnouncementAudience =
  | { kind: 'all' }
  | { kind: 'active' }
  | { kind: 'course'; courseId: string }
  | { kind: 'members'; memberIds: string[] };

export interface NewAnnouncementInput {
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** Also text it: one SMS per phone number (title, start of the text, link to /cont). */
  sms?: boolean;
}

/** A sent announcement as staff see it (`GET /api/announcements`, newest first). */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: string | null;
  /** "Toți membrii", "Cu abonament valabil", "Curs: Kickboxing", "3 membri aleși". */
  audienceLabel: string;
  recipients: number;
  /** Recipients who have opened it in the member portal. */
  read: number;
  /** When also sent by SMS: progress (sent + failed < recipients while sending). */
  sms: { recipients: number; sent: number; failed: number } | null;
}

/** An announcement as the member sees it (`GET /api/account/announcements`). */
export interface MemberAnnouncement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

// ---- Notifications ----

/** `checkin`: admitted; `refused`: scan refused; `reminder`: subscription ends soon. */
export type MemberNotificationKind = 'checkin' | 'refused' | 'reminder' | 'announcement';

/** The member portal's inbox (`GET /api/account/notifications`), newest first. */
export interface MemberNotification {
  id: string;
  kind: MemberNotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

/** Web Push: the server's public VAPID key (`null` when push is unavailable). */
export interface PushConfig {
  publicKey: string | null;
}

/** A browser push subscription (`PushSubscription.toJSON()`), sent by the member portal. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type StaffEventKind = 'checkin' | 'refused' | 'sms-sent' | 'sms-failed';

/** One line of the staff bell's feed. */
export interface StaffEvent {
  id: string;
  kind: StaffEventKind;
  at: string;
  memberId: string | null;
  memberName: string | null;
  /** "Kickboxing · ședința 9/12", "Abonament expirat", "SMS reamintire către 0722…". */
  text: string;
}

/** `GET /api/notifications` (admin and reception), newest first. */
export interface StaffNotifications {
  items: StaffEvent[];
  /** Items newer than the last time this user opened the bell. */
  unread: number;
}

// ---- SMS credit ----

/** `GET /api/sms/credit` (admin and reception): SMS left in the SMSLink account. */
export interface SmsCredit {
  /** SMSLink credentials are set on the server. */
  configured: boolean;
  /** Number of SMS that can still be sent; `null` when unknown. */
  credit: number | null;
  /** Why the credit could not be read, for staff. */
  error: string | null;
}

/** `POST /api/announcements/preview`: what sending to this audience would mean. */
export interface AnnouncementPreview {
  recipients: number;
  /** SMS that would be sent: one per unique phone number. */
  smsCount: number;
}
