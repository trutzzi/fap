import {
  CheckInMethod,
  PaymentMethod,
  PlanId,
  RefusalReason,
  TrainingSlot,
} from '../../app/core/api/models';

export interface PlanEntity {
  id: PlanId;
  name: string;
  description: string;
  sessionLimit: number | null;
  price: number | null;
}

export interface CourseEntity {
  id: string;
  name: string;
  color: string;
  coach: string;
  /** Coach account (see auth.ts) that sees this course's attendees. */
  coachUserId: string | null;
}

export type SlotEntity = TrainingSlot;

export interface SubscriptionEntity {
  planId: PlanId;
  /** Period runs from `startDate` to one month later (exclusive). */
  startDate: string;
}

export interface MemberEntity {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  courseIds: string[];
  /** Normalized: uppercase hex, no separators. */
  rfid: string | null;
  joinedAt: string;
  subscription: SubscriptionEntity | null;
  photoConsent: boolean;
  photo: { mimeType: string; data: Uint8Array; updatedAt: number } | null;
  /** Member portal PIN (4–6 digits), in plain text: this is a mock. `null` until issued. */
  pin: string | null;
  /** HMAC key of the rotating check-in QR code; created on first use. */
  qrSecret: string | null;
}

/** A refused scan, shown in the coach's class list; never counts as a session. */
export interface RefusedScanEntity {
  id: string;
  memberId: string;
  slotId: string | null;
  trainingLabel: string | null;
  date: string;
  timestamp: string;
  reason: RefusalReason;
}

export interface CheckInEntity {
  id: string;
  memberId: string;
  slotId: string | null;
  /** Snapshot of the training name, kept even if the slot is deleted later. */
  trainingLabel: string | null;
  /** Local `YYYY-MM-DD`, denormalized from `timestamp` for fast filtering. */
  date: string;
  timestamp: string;
  method: CheckInMethod;
}

export interface Db {
  plans: PlanEntity[];
  courses: CourseEntity[];
  slots: SlotEntity[];
  members: MemberEntity[];
  checkins: CheckInEntity[];
  refusedScans: RefusedScanEntity[];
  periods: PeriodEntity[];
  payments: PaymentEntity[];
  announcements: AnnouncementEntity[];
  notifications: NotificationEntity[];
}

/** A member portal inbox item (check-ins, announcements); the mock never pushes. */
export interface NotificationEntity {
  id: string;
  memberId: string;
  kind: 'checkin' | 'refused' | 'reminder' | 'announcement';
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

/** A message to members; recipients are fixed when it is sent. */
export interface AnnouncementEntity {
  id: string;
  title: string;
  body: string;
  audienceLabel: string;
  createdAt: string;
  createdBy: string | null;
  recipients: { memberId: string; readAt: string | null }[];
  /** Phones it would have been texted to (the mock has no SMS provider: all fail). */
  smsRecipients: number;
}

/** A sold subscription period (history); unique per member and start date. */
export interface PeriodEntity {
  id: string;
  memberId: string;
  planId: PlanId;
  startDate: string;
  endDate: string;
  price: number | null;
}

export interface PaymentEntity {
  id: string;
  memberId: string;
  periodId: string | null;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  date: string;
  receivedBy: string | null;
  note: string;
}

let sequence = 1000;

export function nextId(prefix: string): string {
  return `${prefix}_${(sequence++).toString(36)}`;
}

export function normalizeRfid(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}
