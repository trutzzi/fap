import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    // Every screen shows live, per-request data from the API, so render in the browser.
    // Prerendering would bake build-time data into the HTML.
    path: '**',
    renderMode: RenderMode.Client,
  },
];
