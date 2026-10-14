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
