# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

REST API of FightAcademy, built with Express 5, TypeScript (ESM, NodeNext), PostgreSQL and Prisma 7. Project-wide context (domain rules, API contract, root `npm start`) is in `../CLAUDE.md`. `README.md` has setup, scripts and the endpoint list.

## Commands

```bash
npm run dev                         # watch mode on :3000
npm test                            # vitest: unit + integration (needs TEST_DATABASE_URL, name must end in _test)
npx vitest run test/domain.test.ts  # single file
npx vitest run -t "session limit"   # single test by name
npm run typecheck
npm run format                      # prettier (same config as the front-end)
npm run db:migrate                  # after editing prisma/schema.prisma (does NOT regenerate the client in Prisma 7)
npm run db:generate                 # regenerate src/generated/prisma
npm run db:seed                     # demo data; creates missing demo accounts with printed random passwords
npm run user:create -- --email x@club.ro --name "Nume" --role admin|reception   # asks for the password
npm run user:password -- --email x@club.ro      # reset (also signs that user out everywhere)
npm run user:deactivate -- --email x@club.ro
```

## Architecture

- **Contract:** `src/contract/models.ts` and `src/lib/dates.ts` are copies of front-end files; never change them here alone (see the root CLAUDE.md).
- **Layers:**
  - `src/domain/` holds pure business rules (membership status, subscription periods, current training, schedule text) and is unit-tested.
  - `src/modules/<area>/*.routes.ts` holds the Express routers, which use Prisma directly.
  - `src/modules/members/member-queries.ts` builds `MemberSummary` objects: member rows plus one raw-SQL aggregate counting sessions used in each member's current period.
- **Dependencies are injected:** `createApp({ db, clock })` in `src/app.ts`. Routers receive `Deps`. Tests pass a fixed clock and a test database; never call `new Date()` for "now" inside routes, use `clock()`.
- **Dates:** the API's date strings are local `YYYY-MM-DD` values in `APP_TIMEZONE` (set as `process.env.TZ` at startup). `@db.Date` columns are converted only through `toDbDate` / `fromDbDate` in `src/db.ts`, which use UTC midnight to avoid timezone drift. `CheckIn.date` is the local date, denormalized from `timestamp`.
- **Subscriptions:** each member has at most one row. `endDate` is stored (not just derived) so usage can be counted in SQL.
- **Check-in** (`modules/check-ins`): it runs in an interactive transaction holding `pg_advisory_xact_lock` per member, so concurrent taps cannot exceed the plan limit. Outcomes are checked in this order: no-subscription → expired → already-checked-in → limit → allowed.
- **Auth** (`modules/auth`):
  - Staff log in with email and password. Passwords are hashed with Node's scrypt (`src/lib/password.ts`, parameters stored in each hash).
  - Sessions are random tokens in the httpOnly, SameSite=Lax `fa_session` cookie. Only the token's SHA-256 is stored, in `sessions`. They last 14 days and slide forward on use.
  - `app.ts` order: `requireJsonForMutations` (CSRF defence) → `authenticate` → public `/auth` and `GET /club` → `requireAuth` → everything else.
  - Roles: `admin` can do everything. `reception` cannot write courses, slots, plans or the club, and cannot delete members. Use `requireAdmin` on a route, or `assertAdmin(req)` inside a handler when a middleware would break Express param typing.
  - Failed logins are rate-limited in memory: 10 per email and 50 per IP per 15 minutes.
  - There is no accounts screen; use the `user:*` scripts. Never commit passwords: the seed reads `SEED_*_PASSWORD` or generates them.
- **Club:** a single `club` row (id 1). Its timezone becomes `process.env.TZ` at startup and on save.
- **Errors:** throw `HttpError` (`badRequest` / `notFound` / `conflict`) with a Romanian user-facing message. Validation uses Zod schemas in `src/lib/validation.ts` via `parse()`, which returns the first issue's message. The error handler in `app.ts` also maps Prisma P2025 → 404 and P2002 → 409.
- **Prisma 7 specifics:**
  - The datasource URL and seed command live in `prisma.config.ts`, which loads `.env` with `process.loadEnvFile`.
  - The client is generated into `src/generated/prisma` (git-ignored, regenerated on `postinstall`) and is constructed with the `@prisma/adapter-pg` driver adapter.
  - Import it from `./generated/prisma/client.js`.
  - Code helpers that must also work inside transactions take `DbClient`.
  - Prisma refuses destructive commands (`migrate reset`) when it detects an AI agent unless the user consents. Don't bypass that guard. Tests use `migrate deploy` plus `TRUNCATE`.
