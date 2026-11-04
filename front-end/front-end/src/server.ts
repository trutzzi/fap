import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Mock REST API (in-memory, fake accounts) for front-end-only work, in development builds
 * only. Production builds replace `ngDevMode` with `false`, so the mock is not even bundled;
 * there, the reverse proxy routes `/api` to the real back-end, and anything that still
 * reaches this server gets a JSON 404 instead of the app's HTML.
 * In dev, `npm run start:api` proxies `/api` to the back-end ahead of this handler.
 * Must be registered before the Angular handler below.
 */
if (typeof ngDevMode === 'undefined' || ngDevMode) {
  const { createMockApi } = await import('./server/mock-api/router');
  app.use('/api', createMockApi());
} else {
  app.use('/api', (_req, res) => {
    res.status(404).json({ message: 'API-ul nu este disponibil la această adresă.' });
  });
}

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
    // Only content-hashed build files (main-AB12CD34.js) may be cached for a year; the
    // manifest, icons and the like must be revalidated so a new deploy shows up.
    setHeaders: (res, path) => {
      if (!/-[A-Z0-9]{8}\.(js|css)$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  // Pages always come fresh, so they reference the current build's files.
  res.setHeader('Cache-Control', 'no-cache');
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
