import { Router } from 'express';
import type { Course, Plan } from '../../contract/models.js';
import type { Db } from '../../db.js';
import type { Deps } from '../../deps.js';
import { scheduleSummary } from '../../domain/schedule.js';
import { badRequest, notFound } from '../../lib/http-error.js';
import { courseSchema, parse, planIdSchema, planSchema, slotSchema } from '../../lib/validation.js';
import { requireAdmin } from '../auth/auth.middleware.js';

async function loadCourses(db: Db, where?: { id: string }): Promise<Course[]> {
  const rows = await db.course.findMany({
    where,
    include: {
      slots: { select: { weekday: true, time: true } },
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    coach: c.coach,
    coachUserId: c.coachUserId,
    scheduleSummary: scheduleSummary(c.slots),
    memberCount: c._count.members,
  }));
}

/** Courses, weekly training slots and subscription plans. Reads: any staff; writes: admin. */
export function catalogRouter({ db }: Deps): Router {
  const router = Router();
  // Mounted at the API root: scope the guard to this router's own paths.
  router.use(['/courses', '/slots', '/plans'], (req, res, next) =>
    req.method === 'GET' ? next() : requireAdmin(req, res, next),
  );

  const courseOrThrow = async (id: string) => {
    const [course] = await loadCourses(db, { id });
    if (!course) throw notFound('Cursul nu a fost găsit.');
    return course;
  };

  // ---- Courses ----

  router.get('/courses', async (_req, res) => {
    res.json(await loadCourses(db));
  });

  /** The linked account, if any, must be an active coach. */
  const parseCourse = async (body: unknown) => {
    const input = parse(courseSchema, body);
    if (input.coachUserId) {
      const coach = await db.user.count({
        where: { id: input.coachUserId, role: 'coach', active: true },
      });
      if (!coach) throw badRequest('Contul de antrenor selectat nu există.');
    }
    return input;
  };

  router.post('/courses', async (req, res) => {
    const course = await db.course.create({ data: await parseCourse(req.body) });
    res.status(201).json(await courseOrThrow(course.id));
  });

  router.put('/courses/:id', async (req, res) => {
    await courseOrThrow(req.params.id);
    await db.course.update({ where: { id: req.params.id }, data: await parseCourse(req.body) });
    res.json(await courseOrThrow(req.params.id));
  });

  /** Cascades to the course's slots and enrollments; past check-ins keep their label. */
  router.delete('/courses/:id', async (req, res) => {
    await db.course.deleteMany({ where: { id: req.params.id } });
    res.status(204).end();
  });

  // ---- Training slots ----

  const checkCourse = async (courseId: string) => {
    if (!(await db.course.count({ where: { id: courseId } })))
      throw badRequest('Cursul selectat nu există.');
  };

  router.get('/slots', async (_req, res) => {
    res.json(await db.trainingSlot.findMany({ orderBy: [{ weekday: 'asc' }, { time: 'asc' }] }));
  });

  router.post('/slots', async (req, res) => {
    const input = parse(slotSchema, req.body);
    await checkCourse(input.courseId);
    res.status(201).json(await db.trainingSlot.create({ data: input }));
  });

  router.put('/slots/:id', async (req, res) => {
    const input = parse(slotSchema, req.body);
    if (!(await db.trainingSlot.count({ where: { id: req.params.id } }))) {
      throw notFound('Antrenamentul nu a fost găsit.');
    }
    await checkCourse(input.courseId);
    res.json(await db.trainingSlot.update({ where: { id: req.params.id }, data: input }));
  });

  router.delete('/slots/:id', async (req, res) => {
    await db.trainingSlot.deleteMany({ where: { id: req.params.id } });
    res.status(204).end();
  });

  // ---- Plans ----

  const loadPlans = async (): Promise<Plan[]> => {
    const rows = await db.plan.findMany({
      include: { _count: { select: { subscriptions: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, memberCount: _count.subscriptions }));
  };

  router.get('/plans', async (_req, res) => {
    res.json(await loadPlans());
  });

  router.put('/plans/:id', async (req, res) => {
    const id = parse(planIdSchema, req.params.id);
    const input = parse(planSchema, req.body);
    // The plan kind is fixed: `unlimited` never gets a limit, the limited plan always has one.
    if (id === 'unlimited' && input.sessionLimit !== null) {
      throw badRequest('Abonamentul nelimitat nu poate avea un număr de ședințe.');
    }
    if (id !== 'unlimited' && input.sessionLimit === null) {
      throw badRequest('Numărul de ședințe este obligatoriu.');
    }
    await db.plan.update({ where: { id }, data: input });
    res.json((await loadPlans()).find((p) => p.id === id));
  });

  return router;
}
