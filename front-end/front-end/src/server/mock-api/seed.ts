import {
  addDays,
  addMonths,
  daysBetween,
  isoWeekday,
  minutesNow,
  minutesOfDay,
  toIsoDate,
} from '../../app/core/util/dates';
import {
  CheckInEntity,
  CourseEntity,
  Db,
  MemberEntity,
  PlanEntity,
  SlotEntity,
  nextId,
} from './db';
import { MOCK_COACH_ID } from './auth';

/** Deterministic PRNG so the generated data is stable across restarts. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLANS: PlanEntity[] = [
  {
    id: 'sessions12',
    name: '12 ședințe / lună',
    description:
      'Fiecare check-in consumă o ședință. La 12/12 accesul este blocat până la reînnoire sau upgrade.',
    sessionLimit: 12,
    price: null,
  },
  {
    id: 'unlimited',
    name: 'Nelimitat',
    description: 'Acces la orice antrenament din orar, fără limită de ședințe, pe durata lunii.',
    sessionLimit: null,
    price: null,
  },
];

const COURSES: Omit<CourseEntity, 'coachUserId'>[] = [
  { id: 'kb', name: 'Kickboxing', color: '#ff3b3b', coach: 'Albu Marius' },
  { id: 'kids', name: 'Kickbox Copii', color: '#ff8fa3', coach: 'Albu Marius' },
  { id: 'mma', name: 'MMA', color: '#ff8a3d', coach: 'Albu Marius' },
  { id: 'bjj', name: 'Grappling & BJJ', color: '#5b9cff', coach: 'Laurentiu Calugaru' },
  { id: 'box', name: 'Box', color: '#f5c518', coach: 'Marius Dumitru' },
  { id: 'kar', name: 'Karate', color: '#d9d9de', coach: 'Ana Balaș' },
];

type SlotSeed = [courseId: string, weekday: number, time: string, capacity: number, label?: string];

const SLOTS: SlotSeed[] = [
  ['kids', 1, '18:00', 20],
  ['kb', 1, '20:00', 30],
  ['bjj', 1, '21:00', 20],
  ['box', 2, '17:00', 20],
  ['mma', 2, '19:00', 24],
  ['kb', 2, '20:00', 30],
  ['kids', 3, '18:00', 20],
  ['kb', 3, '20:00', 30],
  ['bjj', 3, '21:00', 20],
  ['box', 4, '17:00', 20],
  ['mma', 4, '19:00', 24],
  ['kb', 4, '20:00', 30],
  ['kb', 5, '20:00', 30],
  ['bjj', 5, '21:00', 20],
  ['kar', 6, '10:30', 16, 'Karate · Începători'],
  ['box', 6, '14:00', 20],
  ['kar', 7, '11:30', 16, 'Karate · Avansați'],
];

interface MemberSeed {
  first: string;
  last: string;
  phone: string;
  courses: string[];
  plan: PlanEntity['id'] | null;
  /** Subscription start, relative to today in days. */
  startOffset: number;
  /** Exact sessions in the current period; random attendance when omitted. */
  used?: number;
  rfid: string | null;
  joinedDaysAgo: number;
}

/** The members shown in the design, with their exact situations. */
function designMembers(today: string): MemberSeed[] {
  // Start offset for a subscription whose last day is `days` from today.
  const endingIn = (days: number) => daysBetween(today, addMonths(addDays(today, days + 1), -1));
  return [
    {
      first: 'Andrei',
      last: 'Popescu',
      phone: '+40 722 513 418',
      courses: ['kb'],
      plan: 'sessions12',
      startOffset: -13,
      used: 8,
      rfid: '04A391F2',
      joinedDaysAgo: 580,
    },
    {
      first: 'Maria',
      last: 'Ionescu',
      phone: '+40 745 220 102',
      courses: ['kb', 'bjj'],
      plan: 'unlimited',
      startOffset: -13,
      used: 14,
      rfid: '04B722C1',
      joinedDaysAgo: 410,
    },
    {
      first: 'Radu',
      last: 'Dinu',
      phone: '+40 731 874 559',
      courses: ['bjj', 'mma'],
      plan: 'sessions12',
      startOffset: -18,
      used: 11,
      rfid: '04C97A10',
      joinedDaysAgo: 300,
    },
    {
      first: 'Bogdan',
      last: 'Georgescu',
      phone: '+40 768 109 233',
      courses: ['kb'],
      plan: 'sessions12',
      startOffset: -22,
      used: 12,
      rfid: '04D20B4E',
      joinedDaysAgo: 220,
    },
    {
      first: 'Ioana',
      last: 'Marin',
      phone: '+40 724 661 870',
      courses: ['box'],
      plan: 'unlimited',
      startOffset: endingIn(2),
      used: 9,
      rfid: '04E15D33',
      joinedDaysAgo: 190,
    },
    {
      first: 'David',
      last: 'Toma',
      phone: '+40 740 452 315',
      courses: ['kids'],
      plan: 'sessions12',
      startOffset: -22,
      used: 6,
      rfid: '04F088A2',
      joinedDaysAgo: 150,
    },
    {
      first: 'Alexia',
      last: 'Badea',
      phone: '+40 752 337 644',
      courses: ['kar'],
      plan: 'sessions12',
      startOffset: -13,
      used: 4,
      rfid: '04113C7F',
      joinedDaysAgo: 95,
    },
    {
      first: 'Vlad',
      last: 'Petrescu',
      phone: '+40 733 018 921',
      courses: ['mma', 'kb'],
      plan: 'sessions12',
      startOffset: endingIn(-14),
      used: 10,
      rfid: '0422E6D9',
      joinedDaysAgo: 400,
    },
  ];
}

const FIRST = [
  'Mihai',
  'Elena',
  'Cristian',
  'Ana',
  'George',
  'Ioana',
  'Stefan',
  'Diana',
  'Alexandru',
  'Bianca',
  'Tudor',
  'Raluca',
  'Matei',
  'Irina',
  'Paul',
  'Carmen',
  'Victor',
  'Larisa',
  'Florin',
  'Adriana',
];
const LAST = [
  'Stan',
  'Vasile',
  'Dumitrescu',
  'Munteanu',
  'Constantin',
  'Lazăr',
  'Neagu',
  'Moldovan',
  'Rusu',
  'Barbu',
  'Ene',
  'Florea',
  'Matei',
  'Nistor',
  'Oprea',
  'Sandu',
  'Tănase',
  'Ursu',
  'Zamfir',
  'Iordache',
];

function generatedMembers(rand: () => number, count: number): MemberSeed[] {
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
  const adultCourses = ['kb', 'kb', 'kb', 'mma', 'bjj', 'box', 'kar'];
  const result: MemberSeed[] = [];
  for (let i = 0; i < count; i++) {
    const kid = i % 9 === 4;
    const courses = kid ? ['kids'] : [pick(adultCourses)];
    if (!kid && rand() < 0.3) {
      const extra = pick(adultCourses);
      if (!courses.includes(extra)) courses.push(extra);
    }
    const expired = i % 8 === 7;
    const withoutCard = i >= count - 3;
    const phone = `+40 7${Math.floor(20 + rand() * 60)} ${Math.floor(100 + rand() * 900)} ${Math.floor(100 + rand() * 900)}`;
    result.push({
      first: FIRST[(i * 7) % FIRST.length],
      last: LAST[(i * 3 + Math.floor(i / FIRST.length)) % LAST.length],
      phone,
      courses,
      plan: i === count - 1 ? null : rand() < 0.65 ? 'sessions12' : 'unlimited',
      startOffset: expired
        ? -(31 + Math.floor(rand() * 40))
        : withoutCard
          ? -Math.floor(rand() * 3)
          : -Math.floor(rand() * 28),
      rfid: withoutCard
        ? null
        : `04${Math.floor(rand() * 0xffffff)
            .toString(16)
            .toUpperCase()
            .padStart(6, '0')}`,
      joinedDaysAgo: withoutCard ? Math.floor(rand() * 3) : 30 + Math.floor(rand() * 600),
    });
  }
  return result;
}

interface Occurrence {
  slot: SlotEntity;
  date: string;
}

/** Training occurrences of the given courses between two dates, already started by `now`. */
function occurrences(
  slots: SlotEntity[],
  courseIds: string[],
  from: string,
  to: string,
  now: Date,
): Occurrence[] {
  const today = toIsoDate(now);
  const result: Occurrence[] = [];
  for (let date = from; date <= to && date <= today; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    for (const slot of slots) {
      if (slot.weekday !== weekday || !courseIds.includes(slot.courseId)) continue;
      // Members check in a few minutes before the start.
      if (date === today && minutesOfDay(slot.time) - 10 > minutesNow(now)) continue;
      result.push({ slot, date });
    }
  }
  return result.sort((a, b) => (a.date + a.slot.time).localeCompare(b.date + b.slot.time));
}

/** Picks `count` items spread evenly, always including the most recent one. */
function spread<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  if (count <= 0) return [];
  if (count === 1) return [items[items.length - 1]];
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))],
  );
}

export function seed(now = new Date()): Db {
  const rand = mulberry32(20261014);
  const today = toIsoDate(now);
  // Albu Marius has a coach account in the mock (auth.ts); the others don't.
  const courses: CourseEntity[] = COURSES.map((c) => ({
    ...c,
    coachUserId: c.coach === 'Albu Marius' ? MOCK_COACH_ID : null,
  }));
  const slots: SlotEntity[] = SLOTS.map(([courseId, weekday, time, capacity, label]) => ({
    id: nextId('slot'),
    courseId,
    weekday,
    time,
    durationMin: courseId === 'kar' ? 75 : 60,
    capacity,
    label: label ?? null,
  }));
  const courseName = (id: string) => courses.find((c) => c.id === id)?.name ?? null;

  const members: MemberEntity[] = [];
  const checkins: CheckInEntity[] = [];

  const addCheckins = (member: MemberEntity, list: Occurrence[]) => {
    for (const { slot, date } of list) {
      const [h, m] = slot.time.split(':').map(Number);
      const at = new Date(`${date}T00:00:00`);
      at.setHours(h, m - 1 - Math.floor(rand() * 12));
      checkins.push({
        id: nextId('chk'),
        memberId: member.id,
        slotId: slot.id,
        trainingLabel: slot.label ?? courseName(slot.courseId),
        date,
        timestamp: at.toISOString(),
        method: member.rfid && rand() < 0.9 ? 'rfid' : 'manual',
      });
    }
  };

  const seeds = [...designMembers(today), ...generatedMembers(rand, 34)];
  for (const s of seeds) {
    const member: MemberEntity = {
      id: nextId('mem'),
      firstName: s.first,
      lastName: s.last,
      phone: s.phone,
      email: `${s.first}.${s.last[0]}@email.ro`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
      courseIds: s.courses,
      rfid: s.rfid,
      joinedAt: addDays(today, -s.joinedDaysAgo),
      subscription: s.plan ? { planId: s.plan, startDate: addDays(today, s.startOffset) } : null,
      photoConsent: false,
      photo: null,
    };
    members.push(member);
    if (!member.subscription) continue;

    const limit = PLANS.find((p) => p.id === member.subscription!.planId)!.sessionLimit ?? Infinity;
    const start = member.subscription.startDate;
    const end = addDays(addMonths(start, 1), -1);
    // Previous period: regular attendance, capped by the plan limit.
    const previousFrom = addMonths(start, -1);
    const previous = occurrences(slots, member.courseIds, previousFrom, addDays(start, -1), now)
      .filter((o) => o.date >= addDays(today, -s.joinedDaysAgo))
      .filter(() => rand() < 0.55);
    addCheckins(member, previous.slice(0, limit));
    // Current period: the exact count when given, otherwise random attendance.
    const current = occurrences(slots, member.courseIds, start, end, now);
    const target = s.used ?? Math.min(limit, current.filter(() => rand() < 0.5).length);
    addCheckins(member, spread(current, Math.min(target, limit)));
  }

  return {
    plans: PLANS.map((p) => ({ ...p })),
    courses,
    slots,
    members,
    checkins,
    refusedScans: [],
  };
}
