# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Angular front-end of FightAcademy. Project-wide context (design source, domain rules, API contract, root `npm start`) is in `../../CLAUDE.md`. The real API is `../../back-end`; a mock implementation of the same API is built into the SSR server for front-end-only work.

## Commands

```bash
npm start                 # ng serve at http://localhost:4200, using the built-in in-memory mock API
npm run start:api         # ng serve with proxy.conf.json: /api → real back-end on :3000 (root `npm start` runs both)
npm run build             # ng build — production build (default config) into dist/front-end/{browser,server}
npm run watch             # dev build in watch mode
npm test                  # ng test — Vitest via @angular/build:unit-test, jsdom environment
npx ng test --include src/app/app.spec.ts   # run a single spec file
npm run serve:ssr:front-end                 # run the built SSR Express server (PORT env, default 4000)
npx prettier --write <files>                # format (no lint tool is configured)
npx ng generate component <name>            # scaffold; selector prefix is `app`
```

## Architecture

- **Standalone, zoneless Angular 21.** No NgModules and no `zone.js` dependency — change detection is signal-driven. Use signals (`signal`, `computed`, `input()`, `output()`) and the new control flow (`@if`, `@for`) rather than relying on zone-triggered updates.
- **Two bootstrap paths sharing one config:**
  - Browser: `src/main.ts` → `appConfig` (`src/app/app.config.ts`): router, client hydration with event replay.
  - Server: `src/main.server.ts` → `config` (`src/app/app.config.server.ts`), which merges `appConfig` with `provideServerRendering(withRoutes(serverRoutes))`.
  - App-wide providers go in `app.config.ts`; server-only providers go in `app.config.server.ts`.
- **Routing is split in two files:** client routes in `app.routes.ts` (all pages lazy-loaded with `loadComponent`), and per-route render modes in `app.routes.server.ts`.
- **SSR server + mock API:** `src/server.ts` is an Express 5 app (`outputMode: "server"` in `angular.json`). In development builds only (`ngDevMode`), it mounts the mock API at `/api` (`src/server/mock-api/router.ts`) *before* the static files and the Angular catch-all handler. Production builds don't bundle the mock at all and answer `/api` with a JSON 404, because the reverse proxy should route `/api` to the back-end. `ng serve` runs this same server, so `/api/*` works with no back-end. With `--proxy-config proxy.conf.json` (`npm run start:api`), the dev-server proxy answers `/api` before the mock is reached. The data lives in memory, is generated deterministically relative to today's date (`seed.ts`) and resets on every server restart or file change.
- **API contract:** `src/app/core/api/models.ts` and `src/app/core/util/dates.ts` are the source the back-end copies (see the root CLAUDE.md). The mock's domain logic lives in `src/server/mock-api/views.ts` and `router.ts`. Dialogs show the API's `{ message }` errors as-is.
- **Render mode:** every route uses `RenderMode.Client` (in `app.routes.server.ts`) because every screen shows live data. Code that touches the browser still uses `afterNextRender` (see `core/util/interval.ts`) to stay SSR-safe.
- **App layout:** `core/` holds services (`MembersService`, `AcademyService`), `createQuery`, toasts and check-in copy. `shared/ui/` holds small presentational components (icon, modal, session meter, status badge, pipes), `shared/dialogs/` holds the cross-feature dialogs, and `features/*` holds the lazily loaded pages. `layout/shell.ts` is the admin sidebar layout; `/kiosk` renders outside it, full screen.
- **Data loading:** `createQuery(params, load)` (`core/data/query.ts`) is a small wrapper over HttpClient and signals built only on stable APIs (`httpResource`/`rxResource` are still experimental in v21). It re-fetches when signals read in `params` change and exposes `value`/`loading`/`error`/`reload()`. Mutations call the service directly, then `reload()` the affected queries.
- **URL state:** list filters (`/membri?q=&filter=&course=&page=`), the schedule week (`/orar?week=`) and `:id` are bound straight to component `input()`s via `withComponentInputBinding()`. Change them with `router.navigate([], { queryParams, queryParamsHandling: 'merge' })`.
- **Dialogs:** these are native `<dialog>` elements wrapped by `shared/ui/modal.ts`. A modal opens when rendered, and the parent removes it on `(closed)`: `@if (x()) { <app-foo-dialog (closed)="x.set(null)" /> }`. Dialog components call `modal().close()` after a successful save.
- **Auth:**
  - `core/auth/` holds `AuthService` (signed-in user signal; the session is an httpOnly cookie the app never reads), the functional guards (`authGuard`, `adminGuard`, `guestGuard`) and `authInterceptor`. On a 401 the interceptor clears the user and sends them to `/login?redirect=…`.
  - `provideAppInitializer` restores the session before the first navigation.
  - Every route except `/login` needs a session. `/admin/*` (club, courses and weekly template, plans) is admin-only, and `/orar` is read-only.
  - Gate UI with `AuthService.isAdmin`, and keep the API's role rules (back-end CLAUDE.md) as the real enforcement.
  - The mock API (`server/mock-api/auth.ts`) has fake accounts that only work with `npm start`.
- **Kiosk:** USB RFID readers act as keyboards (they type the code, then Enter), so `/kiosk` keeps a visually hidden input focused and re-focuses it on blur. To test without a reader, type a card code (e.g. `04A391F2`, Andrei Popescu) and press Enter.

## Conventions and constraints

- TypeScript strict mode plus Angular `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers`; `noPropertyAccessFromIndexSignature` means index-signature access must use bracket notation (e.g. `process.env['PORT']`).
- Prettier uses the Angular parser for `.html`.
- Components are standalone and use `ChangeDetectionStrategy.OnPush` (it is not the default in v21), `inject()`, signal `input()`/`output()` and typed reactive forms (Signal Forms are experimental).
- Production budgets (`angular.json`): initial bundle warns at 500kB / errors at 1MB; **per-component styles warn at 4kB / error at 8kB**. Design tokens (CSS custom properties) and shared classes (`.card`, `.btn*`, `.chip`, `.badge--*`, `.input`, `.field`, `.form-footer`, …) live in `src/styles.css`; use them before adding component CSS.
- Static assets go in `public/` (served from the site root).

## Reference material

- `llm.txt` (index) and `llm-full.txt` (~850KB full text) are Angular's official LLM documentation dumps. Grep `llm-full.txt` for current Angular APIs instead of relying on memory; don't read it whole.
- `.vscode/mcp.json` configures the Angular CLI MCP server (`npx -y @angular/cli mcp`).
