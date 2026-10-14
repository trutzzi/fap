/** In-memory shapes produced by the seed generator. */
import type { CheckInMethod, PlanId, TrainingSlot } from '../../src/contract/models.js';

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
}

let sequence = 1000;

export function nextId(prefix: string): string {
  return `${prefix}_${(sequence++).toString(36)}`;
}

export function normalizeRfid(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}
