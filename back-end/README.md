# FightAcademy API

REST API for the FightAcademy admin app and the RFID check-in kiosk.
Built with Node.js, Express 5, TypeScript, PostgreSQL and Prisma 7. The Angular app lives in `../front-end/front-end`.

## Setup

Requirements: Node.js 22 or newer, and PostgreSQL 14 or newer.

```bash
cp .env.example .env              # then edit DATABASE_URL / TEST_DATABASE_URL
npm install                       # also generates the Prisma client
npm run db:migrate                # creates the database and applies the migrations
npm run db:seed                   # optional: demo data relative to today
npm run dev                       # http://localhost:3000 (reloads on change)
```

To run the front-end against this API, use `npm run start:api` in `../front-end/front-end`. Its dev server proxies `/api` to port 3000. Plain `npm start` there still uses the front-end's built-in in-memory mock.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the API in watch mode (`tsx`) |
| `npm run build` / `npm start` | Compiles to `dist/` and runs the compiled server |
| `npm test` | Runs domain unit tests plus HTTP integration tests against `TEST_DATABASE_URL` |
| `npm run typecheck` | Checks types without emitting files |
| `npm run db:migrate` | Creates and applies a migration after editing `prisma/schema.prisma` |
| `npm run db:deploy` | Applies existing migrations (production/CI) |
| `npm run db:seed` | Replaces members, courses, schedule and check-ins with demo data; creates missing demo accounts with printed random passwords (refuses when `NODE_ENV=production`) |
| `npm run db:reset` | Drops the database, re-applies migrations, then seeds |
| `npm run db:studio` | Opens Prisma Studio to browse the data |
| `npm run user:create -- --email … --name "…" --role admin\|reception` | Creates a staff account and asks for its password (at least 10 characters) |
| `npm run user:password -- --email …` | Sets a new password and signs that user out everywhere |
| `npm run user:deactivate -- --email …` | Blocks an account |

## Authentication

Staff sign in with email and password (`POST /api/auth/login`). The session is an httpOnly, SameSite=Lax cookie. Two roles exist:

- **admin** can do everything.
- **reception** works with members, subscriptions, cards and check-ins, but cannot change courses, the schedule, plans or the club, and cannot delete members.

Every endpoint except login, logout and `GET /api/club` needs a session. Requests that change data must be sent as JSON.

## Endpoints

All responses are JSON. Errors have the shape `{ "message": "…" }`, with messages in Romanian (the front-end shows them as-is).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness check, including the database |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/auth/me` | Sign in / out, current user |
| GET / PUT | `/api/club` | Club details (GET is public; PUT is admin) |
| GET | `/api/dashboard` | Stat cards, today's trainings, last 7 days, recent check-ins, alerts |
| GET | `/api/members?q=&filter=&courseId=&page=&pageSize=` | Member list (`filter`: all, active, expiring, limit, expired, no-card) |
| POST | `/api/members` | Create a member, optionally with a first subscription |
| GET / PUT / DELETE | `/api/members/:id` | Member detail with check-in history / update / delete |
| PUT | `/api/members/:id/subscription` | Renew or change plan (replaces the current subscription) |
| PUT | `/api/members/:id/rfid` | Assign, replace (`{ rfid }`) or remove (`{ rfid: null }`) a card |
| GET | `/api/members/:id/attendance?month=YYYY-MM` | Days with check-ins in a month |
| GET / POST | `/api/courses` · PUT / DELETE `/api/courses/:id` | Courses (deleting one also removes its trainings) |
| GET / POST | `/api/slots` · PUT / DELETE `/api/slots/:id` | Weekly training template (writes are admin) |
| GET | `/api/schedule?week=YYYY-MM-DD` | Week view with attendance and 4-week averages |
| GET | `/api/plans` · PUT `/api/plans/:id` | Plans: name, description, session limit, price in whole lei (writes are admin) |
| GET | `/api/kiosk/status` | The training currently open for check-in |
| POST | `/api/checkins` | Check in by `{ rfid }` (kiosk) or `{ memberId }` (reception) |

The request and response types are in `src/contract/models.ts`. That file is a copy of the front-end's `src/app/core/api/models.ts`, and the two must be kept in sync.

## Production notes

- Set `NODE_ENV=production`, run `npm run db:deploy` and then `npm start` behind a reverse proxy that serves the Angular app and routes `/api` here. Production builds of the Angular app never include its mock API.
- Create the first admin on the server with `npm run user:create`. Never put passwords in the repository.
- Request logs contain only method, path and status: no cookies, query strings or request bodies.
