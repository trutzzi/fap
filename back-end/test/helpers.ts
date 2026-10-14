import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';
import { SESSION_COOKIE, createSession } from '../src/modules/auth/sessions.js';

export const db = createDb(process.env['TEST_DATABASE_URL']!);

/** Wednesday 14 Oct 2026, 19:45; tests move it with `setNow`. */
const START = () => new Date(2026, 9, 14, 19, 45);
let now = START();
export const setNow = (date: Date) => (now = date);
export const app = createApp({ db, clock: () => now });

export const PASSWORD = 'parola-de-test-123';
export const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.ro', name: 'Admin Test', role: 'admin' },
  reception: { id: 'u-rec', email: 'receptie@test.ro', name: 'Recepție Test', role: 'reception' },
  coach: { id: 'u-coach', email: 'antrenor@test.ro', name: 'Albu Marius', role: 'coach' },
} as const;

let passwordHash: string | undefined;

/** Empties every table and inserts plans, one course with a Wednesday slot, and two users. */
export async function resetData(): Promise<void> {
  now = START();
  passwordHash ??= await hashPassword(PASSWORD); // scrypt is slow on purpose: hash once
  await db.$executeRawUnsafe(
    'TRUNCATE uptime_checks, error_logs, payments, subscription_periods, sessions, users, club, check_ins, subscriptions, member_courses, members, training_slots, courses, plans CASCADE',
  );
  await db.user.createMany({
    data: Object.values(USERS).map((u) => ({ ...u, passwordHash: passwordHash! })),
  });
  await db.plan.createMany({
    data: [
      {
        id: 'sessions12',
        name: '12 ședințe / lună',
        description: '',
        sessionLimit: 12,
        price: 200,
      },
      { id: 'unlimited', name: 'Nelimitat', description: '', sessionLimit: null, price: 300 },
    ],
  });
  await db.course.create({
    data: { id: 'kb', name: 'Kickboxing', color: '#ff3b3b', coach: 'Albu Marius' },
  });
  await db.trainingSlot.create({
    data: {
      id: 'kb-wed',
      courseId: 'kb',
      weekday: 3,
      time: '20:00',
      durationMin: 60,
      capacity: 30,
    },
  });
}

/** A supertest agent already signed in as the given role (session created directly). */
export async function signedIn(role: keyof typeof USERS) {
  const { token } = await createSession(db, USERS[role].id, now);
  return request.agent(app).set('Cookie', `${SESSION_COOKIE}=${token}`);
}
