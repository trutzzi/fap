/**
 * Resets the database to deterministic demo data relative to today's date.
 * Run with `npm run db:seed` (also runs after `npm run db:reset`). Development only.
 */
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { createDb, toDbDate } from '../src/db.js';
import { periodEnd } from '../src/domain/membership.js';
import { hashPassword } from '../src/lib/password.js';
import { seed } from './seed/generate.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database.');
process.env['TZ'] = config.APP_TIMEZONE;

const db = createDb(config.DATABASE_URL);
const data = seed(new Date());

// Club details from the member card design.
const CLUB = {
  name: 'Fight Academy Pitești',
  address: 'Str. Constantin Brâncoveanu, Pitești',
  phone: '+40 730 473 741',
  email: '',
  website: 'fightacademy.ro',
  timezone: config.APP_TIMEZONE,
};

/** Readable random password, e.g. `Ab3d-Ef4g-Hj5k` (no 0/O, 1/l/I). */
function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const groups = Array.from({ length: 3 }, () =>
    Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join(''),
  );
  return groups.join('-');
}

/**
 * Demo staff accounts, created only when missing (existing accounts and their passwords are
 * left alone). Passwords come from SEED_ADMIN_PASSWORD / SEED_RECEPTION_PASSWORD / SEED_COACH_PASSWORD in .env, or
 * are generated and printed once. They are never stored in the repository.
 */
const DEMO_USERS = [
  {
    email: 'admin@fightacademy.ro',
    name: 'Administrator',
    role: 'admin',
    password: process.env['SEED_ADMIN_PASSWORD'],
  },
  {
    email: 'receptie@fightacademy.ro',
    name: 'Recepție',
    role: 'reception',
    password: process.env['SEED_RECEPTION_PASSWORD'],
  },
  {
    // Coaches Kickboxing, Kickbox Copii and MMA in the demo data.
    email: 'antrenor@fightacademy.ro',
    name: 'Albu Marius',
    role: 'coach',
    password: process.env['SEED_COACH_PASSWORD'],
  },
] as const;

await db.$transaction([
  db.club.upsert({
    where: { id: 1 },
    create: { id: 1, ...CLUB },
    update: CLUB,
  }),
  db.refusedScan.deleteMany(),
  db.memberPhoto.deleteMany(),
  db.checkIn.deleteMany(),
  db.subscription.deleteMany(),
  db.memberCourse.deleteMany(),
  db.member.deleteMany(),
  db.trainingSlot.deleteMany(),
  db.course.deleteMany(),
  db.plan.deleteMany(),
  db.plan.createMany({ data: data.plans }),
  db.course.createMany({ data: data.courses }),
  db.trainingSlot.createMany({ data: data.slots }),
  db.member.createMany({
    data: data.members.map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      phone: m.phone,
      email: m.email,
      rfid: m.rfid,
      joinedAt: toDbDate(m.joinedAt),
    })),
  }),
  db.memberCourse.createMany({
    data: data.members.flatMap((m) =>
      m.courseIds.map((courseId) => ({ memberId: m.id, courseId })),
    ),
  }),
  db.subscription.createMany({
    data: data.members
      .filter((m) => m.subscription)
      .map((m) => ({
        memberId: m.id,
        planId: m.subscription!.planId,
        startDate: toDbDate(m.subscription!.startDate),
        endDate: toDbDate(periodEnd(m.subscription!.startDate)),
      })),
  }),
  db.checkIn.createMany({
    data: data.checkins.map((c) => ({
      id: c.id,
      memberId: c.memberId,
      slotId: c.slotId,
      trainingLabel: c.trainingLabel,
      date: toDbDate(c.date),
      timestamp: new Date(c.timestamp),
      method: c.method,
    })),
  }),
]);

for (const { password, ...user } of DEMO_USERS) {
  if (await db.user.findUnique({ where: { email: user.email } })) continue;
  const plain = password || randomPassword();
  await db.user.create({ data: { ...user, passwordHash: await hashPassword(plain) } });
  // Printed once so the developer can sign in; not written anywhere.
  console.log(`Created ${user.role} account ${user.email} with password: ${plain}`);
}

// Courses are re-created above, so link them to their coach's account again.
for (const coach of await db.user.findMany({ where: { role: 'coach' } })) {
  await db.course.updateMany({ where: { coach: coach.name }, data: { coachUserId: coach.id } });
}
console.log(
  `Seeded ${data.members.length} members, ${data.courses.length} courses, ` +
    `${data.slots.length} trainings and ${data.checkins.length} check-ins.`,
);
await db.$disconnect();
