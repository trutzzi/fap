import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { Deps } from './deps.js';
import { Prisma } from './generated/prisma/client.js';
import { HttpError } from './lib/http-error.js';
import { httpLogger } from './lib/http-logger.js';
import {
  authenticate,
  requireAuth,
  requireJsonForMutations,
  restrictCoaches,
} from './modules/auth/auth.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { checkInsRouter } from './modules/check-ins/check-ins.routes.js';
import { clubRouter } from './modules/club/club.routes.js';
import { financeRouter } from './modules/finance/finance.routes.js';
import { insightsRouter } from './modules/insights/insights.routes.js';
import { logsRouter } from './modules/logs/logs.routes.js';
import { recordError } from './modules/logs/uptime-checks.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { membersRouter } from './modules/members/members.routes.js';
import { memberPhotosRouter } from './modules/members/photos.routes.js';
import { trainingsRouter } from './modules/trainings/trainings.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export interface AppOptions extends Deps {
  logger?: Logger;
  /** Express `trust proxy` setting (see `TRUST_PROXY` in config.ts). */
  trustProxy?: string | number;
}

export function createApp({
  logger,
  trustProxy = 'loopback',
  ...deps
}: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet());
  if (logger) app.use(httpLogger(logger));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    await deps.db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  api.use(requireJsonForMutations);
  api.use(authenticate(deps));
  // Public: login and the club's name/contact details. Everything after needs a session.
  api.use('/auth', authRouter(deps));
  api.use('/club', clubRouter(deps));
  api.use(requireAuth);
  api.use(restrictCoaches);
  api.use('/trainings', trainingsRouter(deps));
  api.use('/users', usersRouter(deps));
  api.use('/members', memberPhotosRouter(deps));
  api.use('/members', membersRouter(deps));
  api.use(catalogRouter(deps));
  api.use(insightsRouter(deps));
  api.use(financeRouter(deps));
  api.use(reportsRouter(deps));
  api.use(logsRouter(deps));
  api.use(checkInsRouter(deps));
  api.use((_req, _res, next) => next(new HttpError(404, 'Resursa nu există.')));
  app.use('/api', api);

  app.use(errorHandler(deps));
  return app;
}

/** Maps errors to `{ message }` JSON responses — the shape the front-end displays. */
const errorHandler =
  ({ db }: Deps): ErrorRequestHandler =>
  (err, req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ message: 'Corpul cererii nu este JSON valid.' });
      return;
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ message: 'Fișierul este prea mare.' });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') {
        res.status(404).json({ message: 'Resursa nu a fost găsită.' });
        return;
      }
      if (err.code === 'P2002') {
        res.status(409).json({
          message: 'Valoarea există deja (de exemplu, cardul RFID este alocat altui membru).',
        });
        return;
      }
    }
    (req.log ?? console).error(err);
    void recordError(
      db,
      'api',
      err instanceof Error ? err.message : String(err),
      `${req.method} ${req.path}`,
    );
    res.status(500).json({ message: 'Eroare internă a serverului.' });
  };
