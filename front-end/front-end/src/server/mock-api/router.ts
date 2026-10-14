import express, { NextFunction, Request, Response } from 'express';
import {
  CheckInResult,
  Club,
  CourseInput,
  MemberFilter,
  MemberInput,
  NewMemberInput,
  PaymentInput,
  PaymentMethod,
  PlanId,
  SubscriptionInput,
  TrainingSlotInput,
} from '../../app/core/api/models';
import { isIsoDate, startOfWeek, toIsoDate } from '../../app/core/util/dates';
import { DEMO_USERS, MockSessions } from './auth';
import { MockFinance } from './finance';
import { MockReports } from './reports';
import { Db, MemberEntity, nextId, normalizeRfid } from './db';
import { seed } from './seed';
import { Views } from './views';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const badRequest = (message: string) => new HttpError(400, message);

// ---- Input validation --------------------------------------------------------

type Body = Record<string, unknown>;

function text(body: Body, key: string, label: string, { required = true, max = 80 } = {}): string {
  const value = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  if (required && !value) throw badRequest(`${label} este obligatoriu.`);
  if (value.length > max) throw badRequest(`${label} poate avea maximum ${max} caractere.`);
  return value;
}

function integer(body: Body, key: string, label: string, min: number, max: number): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${label} trebuie să fie un număr între ${min} și ${max}.`);
  }
  return value;
}

function isPlanId(value: unknown): value is PlanId {
  return value === 'sessions12' || value === 'unlimited';
}

function parsePayment(value: unknown): PaymentInput {
  const b = (value ?? {}) as Body;
  const amount = b['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100_000) {
    throw badRequest('Suma trebuie să fie de cel puțin 1 leu.');
  }
  if (!['cash', 'card', 'transfer'].includes(b['method'] as string)) {
    throw badRequest('Metoda de plată este invalidă.');
  }
  return {
    amount,
    method: b['method'] as PaymentMethod,
    note: typeof b['note'] === 'string' ? b['note'].slice(0, 200) : '',
  };
}

function parseSubscription(body: unknown): SubscriptionInput {
  const b = (body ?? {}) as Body;
  if (!isPlanId(b['planId'])) throw badRequest('Tipul de abonament este invalid.');
  if (!isIsoDate(b['startDate'])) throw badRequest('Data de început este invalidă.');
  return {
    planId: b['planId'],
    startDate: b['startDate'],
    payment: b['payment'] ? parsePayment(b['payment']) : null,
  };
}

const MEMBER_FILTERS: MemberFilter[] = ['all', 'active', 'expiring', 'limit', 'expired', 'no-card'];

// ---- Router ------------------------------------------------------------------

/**
 * In-memory mock of the platform API, mounted at `/api` by `src/server.ts`.
 * Data is generated relative to the current date and resets on server restart.
 */
export function createMockApi(db: Db = seed()): express.Router {
  const views = new Views(db);
  const finance = new MockFinance(db, views);
  const reports = new MockReports(db, views);
  const sessions = new MockSessions();
  let club: Club = {
    name: 'Fight Academy Pitești',
    address: 'Str. Constantin Brâncoveanu, Pitești',
    phone: '+40 730 473 741',
    email: '',
    website: 'fightacademy.ro',
    timezone: 'Europe/Bucharest',
  };
  const api = express.Router();
  api.use(express.json());

  // ---- Auth (same rules as the real back-end) ----

  // State-changing requests must be JSON, or an image for photo uploads (CSRF defence).
  api.use((req, _res, next) => {
    const mutates = ['POST', 'PUT', 'PATCH'].includes(req.method);
    const allowed = req.is(['application/json', 'image/jpeg', 'image/png', 'image/webp']);
    next(mutates && !allowed ? new HttpError(415, 'Cererea trebuie să fie JSON.') : undefined);
  });

  api.post('/auth/login', (req, res) => {
    const b = (req.body ?? {}) as Body;
    const user = sessions.login(String(b['email'] ?? ''), String(b['password'] ?? ''));
    if (!user) throw new HttpError(401, 'Email sau parolă greșită.');
    sessions.start(res, user);
    res.json(user);
  });

  api.get('/auth/me', (req, res) => {
    const user = sessions.user(req);
    if (!user) throw new HttpError(401, 'Autentifică-te pentru a continua.');
    res.json(user);
  });

  api.post('/auth/logout', (req, res) => {
    sessions.end(req, res);
    res.status(204).end();
  });

  api.get('/club', (_req, res) => {
    res.json(club);
  });

  api.use((req, _res, next) => {
    next(sessions.user(req) ? undefined : new HttpError(401, 'Autentifică-te pentru a continua.'));
  });

  // Coaches: read-only views of their classes, the schedule, and check-in (as the back-end).
  const coachAllowed: [string, RegExp][] = [
    ['GET', /^\/trainings\/today$/],
    ['GET', /^\/members\/[^/]+\/photo$/],
    ['GET', /^\/schedule$/],
    ['GET', /^\/courses$/],
    ['GET', /^\/slots$/],
    ['GET', /^\/kiosk\/status$/],
    ['POST', /^\/checkins$/],
  ];
  api.use((req, _res, next) => {
    const ok =
      sessions.user(req)?.role !== 'coach' ||
      coachAllowed.some(([method, path]) => method === req.method && path.test(req.path));
    next(ok ? undefined : new HttpError(403, 'Nu ai drepturi pentru această acțiune.'));
  });

  api.get('/trainings/today', (req, res) => {
    const user = sessions.user(req)!;
    res.json(views.trainingsToday(user.role === 'coach' ? user.id : undefined));
  });

  api.get('/users/coaches', (req, res) => {
    assertAdmin(req);
    res.json(DEMO_USERS.filter((u) => u.role === 'coach').map(({ id, name }) => ({ id, name })));
  });

  // ---- Member photos ----

  api.get('/members/:id/photo', (req, res) => {
    const member = findMember(req.params['id']);
    const user = sessions.user(req)!;
    if (user.role === 'coach') {
      const coached = db.courses.filter((c) => c.coachUserId === user.id).map((c) => c.id);
      if (!member.courseIds.some((id) => coached.includes(id))) {
        throw new HttpError(403, 'Nu ai drepturi pentru această acțiune.');
      }
    }
    if (!member.photo) throw new HttpError(404, 'Membrul nu are fotografie.');
    res
      .type(member.photo.mimeType)
      .set('Cache-Control', 'private, max-age=86400')
      .send(Buffer.from(member.photo.data));
  });

  api.put(
    '/members/:id/photo',
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '1mb' }),
    (req, res) => {
      const member = findMember(req.params['id']);
      if (!member.photoConsent)
        throw new HttpError(409, 'Bifează mai întâi acordul pentru fotografie (GDPR).');
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const jpeg = data[0] === 0xff && data[1] === 0xd8;
      const png = data[0] === 0x89 && data[1] === 0x50;
      const webp = data.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!jpeg && !png && !webp)
        throw badRequest('Fișierul trebuie să fie o imagine JPEG, PNG sau WebP.');
      member.photo = {
        mimeType: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp',
        data,
        updatedAt: Date.now(),
      };
      res.json(views.summary(member));
    },
  );

  api.delete('/members/:id/photo', (req, res) => {
    const member = findMember(req.params['id']);
    member.photo = null;
    res.json(views.summary(member));
  });

  const assertAdmin = (req: Request) => {
    if (sessions.user(req)?.role !== 'admin') {
      throw new HttpError(403, 'Nu ai drepturi pentru această acțiune.');
    }
  };

  api.put('/club', (req, res) => {
    assertAdmin(req);
    const b = (req.body ?? {}) as Body;
    const timezone = text(b, 'timezone', 'Fusul orar', { max: 60 });
    if (!Intl.supportedValuesOf('timeZone').includes(timezone))
      throw badRequest('Fusul orar este invalid.');
    club = {
      name: text(b, 'name', 'Numele clubului', { max: 80 }),
      address: text(b, 'address', 'Adresa', { required: false, max: 160 }),
      phone: text(b, 'phone', 'Telefonul', { required: false, max: 30 }),
      email: text(b, 'email', 'Emailul', { required: false, max: 120 }),
      website: text(b, 'website', 'Site-ul', { required: false, max: 120 }),
      timezone,
    };
    res.json(club);
  });

  const findMember = (id: string): MemberEntity => {
    const member = db.members.find((m) => m.id === id);
    if (!member) throw new HttpError(404, 'Membrul nu a fost găsit.');
    return member;
  };

  const parseRfid = (value: unknown, memberId: string | null): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') throw badRequest('Codul cardului RFID este invalid.');
    const rfid = normalizeRfid(value);
    if (!/^[0-9A-F]{4,20}$/.test(rfid)) {
      throw badRequest('Codul cardului RFID trebuie să conțină 4–20 caractere hexazecimale.');
    }
    const owner = db.members.find((m) => m.rfid === rfid && m.id !== memberId);
    if (owner) {
      throw new HttpError(409, `Cardul este deja alocat lui ${owner.firstName} ${owner.lastName}.`);
    }
    return rfid;
  };

  const parseMember = (body: unknown, memberId: string | null): MemberInput => {
    const b = (body ?? {}) as Body;
    const phone = text(b, 'phone', 'Telefonul', { max: 20 });
    if (!/^[0-9 +().-]{6,20}$/.test(phone)) throw badRequest('Numărul de telefon este invalid.');
    const email = text(b, 'email', 'Emailul', { required: false, max: 120 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw badRequest('Adresa de email este invalidă.');
    }
    const courseIds = Array.isArray(b['courseIds']) ? [...new Set(b['courseIds'])] : [];
    if (!courseIds.every((id) => db.courses.some((c) => c.id === id))) {
      throw badRequest('Unul dintre cursuri nu există.');
    }
    return {
      firstName: text(b, 'firstName', 'Prenumele', { max: 40 }),
      lastName: text(b, 'lastName', 'Numele', { max: 40 }),
      phone,
      email,
      courseIds: courseIds as string[],
      rfid: parseRfid(b['rfid'], memberId),
      photoConsent: b['photoConsent'] === true,
    };
  };

  const parseCoachUserId = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    if (!DEMO_USERS.some((u) => u.id === value && u.role === 'coach')) {
      throw badRequest('Contul de antrenor selectat nu există.');
    }
    return value as string;
  };

  const parseCourse = (body: unknown): CourseInput => {
    const b = (body ?? {}) as Body;
    const color = text(b, 'color', 'Culoarea', { max: 7 });
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw badRequest('Culoarea trebuie să fie în format #rrggbb.');
    return {
      name: text(b, 'name', 'Numele cursului', { max: 40 }),
      color,
      coach: text(b, 'coach', 'Antrenorul', { max: 60 }),
      coachUserId: parseCoachUserId(b['coachUserId']),
    };
  };

  const parseSlot = (body: unknown): TrainingSlotInput => {
    const b = (body ?? {}) as Body;
    if (!db.courses.some((c) => c.id === b['courseId']))
      throw badRequest('Cursul selectat nu există.');
    const time = text(b, 'time', 'Ora', { max: 5 });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw badRequest('Ora trebuie să fie în format HH:mm.');
    return {
      courseId: b['courseId'] as string,
      weekday: integer(b, 'weekday', 'Ziua', 1, 7),
      time,
      durationMin: integer(b, 'durationMin', 'Durata', 15, 240),
      capacity: integer(b, 'capacity', 'Capacitatea', 1, 200),
      label: text(b, 'label', 'Eticheta', { required: false, max: 40 }) || null,
    };
  };

  // ---- Dashboard & schedule ----

  api.get('/dashboard', (_req, res) => {
    res.json(views.dashboard());
  });

  api.get('/schedule', (req, res) => {
    const week = req.query['week'];
    const start = startOfWeek(isIsoDate(week) ? week : toIsoDate(new Date()));
    res.json(views.weekSchedule(start));
  });

  api.get('/slots', (_req, res) => {
    res.json([...db.slots].sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time)));
  });

  api.post('/slots', (req, res) => {
    assertAdmin(req);
    const slot = { id: nextId('slot'), ...parseSlot(req.body) };
    db.slots.push(slot);
    res.status(201).json(slot);
  });

  api.put('/slots/:id', (req, res) => {
    assertAdmin(req);
    const slot = db.slots.find((s) => s.id === req.params['id']);
    if (!slot) throw new HttpError(404, 'Antrenamentul nu a fost găsit.');
    Object.assign(slot, parseSlot(req.body));
    res.json(slot);
  });

  api.delete('/slots/:id', (req, res) => {
    assertAdmin(req);
    db.slots = db.slots.filter((s) => s.id !== req.params['id']);
    res.status(204).end();
  });

  // ---- Courses & plans ----

  api.get('/courses', (_req, res) => {
    res.json(views.courses());
  });

  api.post('/courses', (req, res) => {
    assertAdmin(req);
    const course = { id: nextId('course'), ...parseCourse(req.body) };
    db.courses.push(course);
    res.status(201).json(views.courses().find((c) => c.id === course.id));
  });

  api.put('/courses/:id', (req, res) => {
    assertAdmin(req);
    const course = db.courses.find((c) => c.id === req.params['id']);
    if (!course) throw new HttpError(404, 'Cursul nu a fost găsit.');
    Object.assign(course, parseCourse(req.body));
    res.json(views.courses().find((c) => c.id === course.id));
  });

  api.delete('/courses/:id', (req, res) => {
    assertAdmin(req);
    const id = req.params['id'];
    db.courses = db.courses.filter((c) => c.id !== id);
    db.slots = db.slots.filter((s) => s.courseId !== id);
    for (const m of db.members) m.courseIds = m.courseIds.filter((c) => c !== id);
    res.status(204).end();
  });

  api.get('/plans', (_req, res) => {
    res.json(views.plans());
  });

  api.put('/plans/:id', (req, res) => {
    assertAdmin(req);
    const plan = db.plans.find((p) => p.id === req.params['id']);
    if (!plan) throw new HttpError(404, 'Abonamentul nu a fost găsit.');
    const b = (req.body ?? {}) as Body;
    const price = b['price'];
    if (
      price !== null &&
      (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 100_000)
    ) {
      throw badRequest('Prețul este invalid.');
    }
    const sessionLimit = b['sessionLimit'] ?? null;
    if (plan.id === 'unlimited' && sessionLimit !== null) {
      throw badRequest('Abonamentul nelimitat nu poate avea un număr de ședințe.');
    }
    if (plan.id !== 'unlimited') integer(b, 'sessionLimit', 'Numărul de ședințe', 1, 100);
    plan.name = text(b, 'name', 'Numele abonamentului', { max: 40 });
    plan.description = text(b, 'description', 'Descrierea', { required: false, max: 300 });
    plan.sessionLimit = sessionLimit as number | null;
    plan.price = price;
    res.json(views.plans().find((p) => p.id === plan.id));
  });

  // ---- Members ----

  api.get('/members', (req, res) => {
    const { q, filter, courseId, page, pageSize } = req.query;
    res.json(
      views.members({
        q: typeof q === 'string' ? q : undefined,
        filter: MEMBER_FILTERS.includes(filter as MemberFilter) ? (filter as MemberFilter) : 'all',
        courseId: typeof courseId === 'string' && courseId ? courseId : undefined,
        page: Number(page) || 1,
        pageSize: Number(pageSize) || 10,
      }),
    );
  });

  api.post('/members', (req, res) => {
    const input = parseMember(req.body, null);
    const sub = (req.body as Partial<NewMemberInput>).subscription;
    const member: MemberEntity = {
      id: nextId('mem'),
      ...input,
      joinedAt: toIsoDate(new Date()),
      subscription: null,
      photo: null,
    };
    db.members.push(member);
    if (sub) finance.sell(member.id, parseSubscription(sub), sessions.user(req)!.name);
    res.status(201).json(views.summary(member));
  });

  api.get('/members/:id', (req, res) => {
    const member = findMember(req.params['id']);
    res.json({ ...views.memberDetail(member), periods: finance.periodsOf(member.id) });
  });

  // ---- Finance (staff only: coaches are not in the allowlist) ----

  api.get('/finance', (req, res) => {
    const month = req.query['month'];
    const valid = typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
    res.json(finance.summary(valid ? month : toIsoDate(new Date()).slice(0, 7)));
  });

  // ---- Reports (staff only) ----

  const monthParam = (value: unknown): string =>
    typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
      ? value
      : toIsoDate(new Date()).slice(0, 7);

  api.get('/reports', (req, res) => {
    res.json(reports.summary(monthParam(req.query['month'])));
  });
  api.get('/reports/attendance.csv', (req, res) => {
    reports.attendanceCsv(res, monthParam(req.query['month']));
  });
  api.get('/reports/payments.csv', (req, res) => {
    reports.paymentsCsv(res, monthParam(req.query['month']));
  });
  api.get('/reports/members.csv', (_req, res) => {
    reports.membersCsv(res);
  });

  api.post('/payments', (req, res) => {
    const b = (req.body ?? {}) as Body;
    const member = findMember(String(b['memberId'] ?? ''));
    const periodId = typeof b['periodId'] === 'string' && b['periodId'] ? b['periodId'] : null;
    if (periodId && !db.periods.some((p) => p.id === periodId && p.memberId === member.id)) {
      throw badRequest('Perioada de abonament nu aparține acestui membru.');
    }
    res
      .status(201)
      .json(finance.pay(member.id, periodId, parsePayment(b), sessions.user(req)!.name));
  });

  api.delete('/payments/:id', (req, res) => {
    assertAdmin(req);
    db.payments = db.payments.filter((p) => p.id !== req.params['id']);
    res.status(204).end();
  });

  api.put('/members/:id', (req, res) => {
    const member = findMember(req.params['id']);
    Object.assign(member, parseMember(req.body, member.id));
    if (!member.photoConsent) member.photo = null; // GDPR: withdrawn consent deletes the photo
    res.json(views.summary(member));
  });

  api.delete('/members/:id', (req, res) => {
    assertAdmin(req);
    const member = findMember(req.params['id']);
    db.members = db.members.filter((m) => m !== member);
    db.checkins = db.checkins.filter((c) => c.memberId !== member.id);
    res.status(204).end();
  });

  api.put('/members/:id/subscription', (req, res) => {
    const member = findMember(req.params['id']);
    finance.sell(member.id, parseSubscription(req.body), sessions.user(req)!.name);
    res.json(views.summary(member));
  });

  api.put('/members/:id/rfid', (req, res) => {
    const member = findMember(req.params['id']);
    member.rfid = parseRfid((req.body as Body | undefined)?.['rfid'], member.id);
    res.json(views.summary(member));
  });

  api.get('/members/:id/attendance', (req, res) => {
    const month = req.query['month'];
    const valid = typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
    res.json(
      views.attendance(
        findMember(req.params['id']),
        valid ? month : toIsoDate(new Date()).slice(0, 7),
      ),
    );
  });

  // ---- Kiosk & check-in ----

  api.get('/kiosk/status', (_req, res) => {
    res.json({ current: views.currentTraining() });
  });

  api.post('/checkins', (req, res) => {
    const body = (req.body ?? {}) as Body;
    let member: MemberEntity | undefined;
    if (typeof body['rfid'] === 'string' && body['rfid'].trim()) {
      member = db.members.find((m) => m.rfid === normalizeRfid(body['rfid'] as string));
    } else if (typeof body['memberId'] === 'string') {
      member = findMember(body['memberId']);
    } else {
      throw badRequest('Trimite un card RFID sau un membru.');
    }

    const reply = (outcome: CheckInResult['outcome'], trainingLabel: string | null = null) => {
      const result: CheckInResult = {
        outcome,
        member: member ? views.summary(member) : null,
        trainingLabel,
      };
      res.json(result);
    };
    if (!member) return reply('unknown-card');
    const memberId = member.id;

    const slot = views.currentSlot(member.courseIds);
    const label = slot ? views.slotLabel(slot) : null;
    const summary = views.summary(member);
    const now = new Date();
    const today = toIsoDate(now);
    const refuse = (reason: 'limit' | 'expired' | 'no-subscription') => {
      const slotId = slot?.id ?? null;
      const previous = db.refusedScans.find(
        (r) => r.memberId === memberId && r.date === today && r.slotId === slotId,
      );
      if (previous) Object.assign(previous, { reason, timestamp: now.toISOString() });
      else {
        db.refusedScans.push({
          id: nextId('ref'),
          memberId,
          slotId,
          trainingLabel: label,
          date: today,
          timestamp: now.toISOString(),
          reason,
        });
      }
      return reply(reason, label);
    };
    if (summary.status === 'none' || summary.subscription!.startDate > today) {
      return refuse('no-subscription');
    }
    if (summary.status === 'expired') return refuse('expired');

    // A second tap for the same training must not consume another session.
    const duplicate = db.checkins.some(
      (c) =>
        c.memberId === memberId &&
        c.date === today &&
        (slot ? c.slotId === slot.id : now.getTime() - Date.parse(c.timestamp) < 2 * 3_600_000),
    );
    if (duplicate) return reply('already-checked-in', label);
    if (summary.status === 'limit') return refuse('limit');

    db.checkins.push({
      id: nextId('chk'),
      memberId,
      slotId: slot?.id ?? null,
      trainingLabel: label,
      date: today,
      timestamp: now.toISOString(),
      method: body['rfid'] ? 'rfid' : 'manual',
    });
    return reply('allowed', label);
  });

  // ---- Errors ----

  api.use((_req, _res, next) => next(new HttpError(404, 'Resursa nu există.')));
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ message: err.message });
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ message: 'Corpul cererii nu este JSON valid.' });
    } else {
      console.error(err);
      res.status(500).json({ message: 'Eroare internă a serverului.' });
    }
  });

  return api;
}
