import { Db, MemberEntity } from './db';
import { Views } from './views';

/** Wednesday 14 Oct 2026, 19:45 local time. */
const NOW = new Date(2026, 9, 14, 19, 45);

function createDb(): Db {
  return {
    plans: [
      {
        id: 'sessions12',
        name: '12 ședințe / lună',
        description: '',
        sessionLimit: 12,
        price: 200,
      },
      { id: 'unlimited', name: 'Nelimitat', description: '', sessionLimit: null, price: 300 },
    ],
    courses: [
      { id: 'kb', name: 'Kickboxing', color: '#ff3b3b', coach: 'Albu Marius', coachUserId: null },
    ],
    slots: [
      {
        id: 's-mon',
        courseId: 'kb',
        weekday: 1,
        time: '20:00',
        durationMin: 60,
        capacity: 30,
        label: null,
      },
      {
        id: 's-wed',
        courseId: 'kb',
        weekday: 3,
        time: '20:00',
        durationMin: 60,
        capacity: 30,
        label: null,
      },
      {
        id: 's-fri',
        courseId: 'kb',
        weekday: 5,
        time: '20:00',
        durationMin: 60,
        capacity: 30,
        label: null,
      },
    ],
    members: [],
    checkins: [],
    refusedScans: [],
    periods: [],
    payments: [],
  };
}

function addMember(db: Db, overrides: Partial<MemberEntity>, sessions = 0): MemberEntity {
  const member: MemberEntity = {
    id: `m${db.members.length + 1}`,
    firstName: 'Andrei',
    lastName: 'Popescu',
    phone: '0722 513 418',
    email: '',
    courseIds: ['kb'],
    rfid: null,
    joinedAt: '2026-01-01',
    subscription: { planId: 'sessions12', startDate: '2026-10-01' },
    photoConsent: false,
    photo: null,
    ...overrides,
  };
  db.members.push(member);
  for (let i = 0; i < sessions; i++) {
    const date = `2026-10-${String(i + 1).padStart(2, '0')}`;
    db.checkins.push({
      id: `${member.id}-c${i}`,
      memberId: member.id,
      slotId: null,
      trainingLabel: 'Kickboxing',
      date,
      timestamp: `${date}T17:00:00.000Z`,
      method: 'rfid',
    });
  }
  return member;
}

describe('Views', () => {
  let db: Db;
  let views: Views;

  beforeEach(() => {
    db = createDb();
    views = new Views(db, () => NOW);
  });

  it('counts sessions used in the subscription period', () => {
    const member = addMember(db, {}, 8);
    expect(views.usage(member)).toEqual(
      expect.objectContaining({
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        used: 8,
        remaining: 4,
      }),
    );
    expect(views.summary(member).status).toBe('active');
  });

  it('derives membership status', () => {
    const status = (m: MemberEntity) => views.summary(m).status;
    expect(status(addMember(db, {}, 12))).toBe('limit');
    expect(status(addMember(db, {}, 11))).toBe('expiring'); // one session left
    expect(
      status(addMember(db, { subscription: { planId: 'unlimited', startDate: '2026-09-17' } })),
    ).toBe(
      'expiring', // ends 16 Oct
    );
    expect(
      status(addMember(db, { subscription: { planId: 'sessions12', startDate: '2026-09-01' } })),
    ).toBe('expired');
    expect(status(addMember(db, { subscription: null }))).toBe('none');
    expect(
      status(addMember(db, { subscription: { planId: 'unlimited', startDate: '2026-10-01' } }, 20)),
    ).toBe('active');
  });

  it('filters and searches members', () => {
    addMember(db, { firstName: 'Maria', lastName: 'Ionescu', rfid: '04B722C1' });
    addMember(db, { firstName: 'Vlad', lastName: 'Petrescu', subscription: null });
    expect(views.members({ q: 'mar' }).items.map((m) => m.fullName)).toEqual(['Maria Ionescu']);
    expect(views.members({ q: '04b7·22' }).items).toHaveLength(1);
    expect(views.members({ filter: 'expired' }).items.map((m) => m.fullName)).toEqual([
      'Vlad Petrescu',
    ]);
    expect(views.members({ filter: 'no-card' }).total).toBe(1);
    expect(views.members({})).toEqual(
      expect.objectContaining({ activeCount: 1, inactiveCount: 1 }),
    );
  });

  it('finds the training a check-in belongs to (30 minutes before start)', () => {
    expect(views.currentSlot(['kb'])?.id).toBe('s-wed');
    const early = new Views(db, () => new Date(2026, 9, 14, 19, 20));
    expect(early.currentSlot(['kb'])).toBeNull();
  });

  it('summarizes weekly schedules', () => {
    expect(views.scheduleSummary('kb')).toBe('Luni, Miercuri, Vineri · 20:00');
    db.slots.push(
      {
        id: 's-tue',
        courseId: 'kb',
        weekday: 2,
        time: '20:00',
        durationMin: 60,
        capacity: 30,
        label: null,
      },
      {
        id: 's-thu',
        courseId: 'kb',
        weekday: 4,
        time: '20:00',
        durationMin: 60,
        capacity: 30,
        label: null,
      },
    );
    expect(views.scheduleSummary('kb')).toBe('Luni – Vineri · 20:00');
  });

  it('builds dashboard alerts for limits, expirations and missing cards', () => {
    addMember(db, { firstName: 'Bogdan', lastName: 'Georgescu', rfid: '04D20B4E' }, 12);
    addMember(db, {
      firstName: 'Ioana',
      lastName: 'Marin',
      subscription: { planId: 'unlimited', startDate: '2026-09-17' },
    });
    const alerts = views.dashboard().alerts;
    expect(alerts.map((a) => a.kind)).toEqual(['limit', 'expiring', 'no-card']);
    expect(alerts[0].detail).toBe('A atins limita de 12 ședințe · expiră 31 oct');
    expect(alerts[2].detail).toBe('1 membru fără card');
  });
});
