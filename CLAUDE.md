# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FightAcademy is an admin app plus an RFID check-in kiosk for a martial-arts gym. The UI and all user-facing messages are in Romanian. The design source is the Claude Design canvas https://claude.ai/artifact/KoXK6xJXtdRxjDky1RPHj1. Its "Platformă" page (Dashboard, Membri, Profil membru, Orar & Cursuri, Kiosk) is implemented. Its "Card membru" page (the printed RFID card, front and back) is print artwork and deliberately not part of the app. The logo is `front-end/front-end/public/logo-fight-academy.png`, taken from the canvas.

## Layout

```
fight-academy-platform/
├── package.json          # root scripts only (runs both projects); its only dependency is `concurrently`
├── front-end/front-end/  # Angular 21 app with SSR and a built-in mock API → see its CLAUDE.md
└── back-end/             # Express 5 + PostgreSQL + Prisma 7 REST API     → see its CLAUDE.md
```

These are **not npm workspaces**. Each project has its own `node_modules` and `package-lock.json`, and the root scripts call into them with `npm --prefix <dir>`. Run project-specific commands (for example a single test) from inside that project.

## Root commands

```bash
npm run setup        # npm install in the root, back-end and front-end
npm start            # API on :3000 + Angular on :4200 (proxies /api to :3000); Ctrl+C stops both
npm run start:mock   # front-end only, using its in-memory mock API (no database needed)
npm run build        # back-end, then front-end
npm test             # back-end tests (needs PostgreSQL), then front-end tests
npm run format       # prettier in both projects
npm run db:migrate   # back-end Prisma migrations; also db:seed, db:studio
```

## Cross-project rules

- **API contract:** `front-end/front-end/src/app/core/api/models.ts` defines every request and response type, and `back-end/src/contract/models.ts` is a copy of it. The same applies to `front-end/.../src/app/core/util/dates.ts` and `back-end/src/lib/dates.ts`. When an endpoint changes, update both copies, the back-end route, and the front-end mock (`front-end/front-end/src/server/mock-api`) so the mock stays a faithful stand-in.
- **Errors** are JSON `{ "message": "…" }` with Romanian, user-facing text. The front-end shows them as-is, so write them for gym staff.
- **Dates** on the wire are local `YYYY-MM-DD` strings in the academy timezone (`Europe/Bucharest`). Timestamps are ISO 8601.
- **Domain rules** (the back-end `src/domain/` and the front-end mock must agree):
  - Plans: `sessions12` (each check-in uses one session; check-in is blocked at 12/12) and `unlimited`. A subscription period runs from `startDate` to start + 1 month − 1 day. Setting a subscription replaces the current one.
  - Member status: `none` (no subscription) → `expired` (end < today) → `limit` (0 sessions left) → `expiring` (fewer than 7 days or 1 session left) → `active`. The `active` list filter includes `expiring` and `limit`.
  - A check-in attaches to the training that is running or starts within 30 minutes, preferring the member's own courses and, among them, the latest to start. For example, a member of Karate 17:00 and BJJ 18:00 who taps at 17:35 checks in to BJJ. Each training is its own check-in (and session). Tapping again for the same training returns `already-checked-in` and doesn't use a session.
  - Check-in methods: an RFID card, the member's QR code (`{ qr }`, method `qr`), or manual at reception. The QR code comes from the member portal (`/cont`). It is HMAC-signed with a per-member secret, rotates every 30 s, and is accepted for at most 90 s. An invalid or old code returns `invalid-qr`.
  - Member portal: adding a member generates a 6-digit PIN. Members can change it to any 4–6 digit PIN. The PIN is texted only if SMS sending is switched on in Administrare › Club (`Club.smsEnabled`, off by default). Otherwise reception is shown the PIN to hand over in person. Login uses phone + PIN, and phones match in any format (`+40 722…` = `0722…`). Phones aren't unique (siblings), so the PIN picks the member, and it is kept unique per phone. Issuing a new PIN signs the member out. The result's `sms` is `sent`, `disabled` or `failed`, and reception sees the PIN unless it was `sent`.
  - Announcements: admin and reception send a title and message to all members, members with a valid subscription, a course's members, or chosen members. Recipients are fixed at send time. Members see them in `/cont` (unread until they open the page), and staff see read counts. Withdrawing deletes it for everyone.
  - Deleting members (one, or in bulk from the list) is admin-only and permanent, including their history.
- Missing business facts (for example plan prices) appear as placeholders like `[PREȚ]`, never as invented values.
- Prettier is shared: 100-character lines, single quotes.

## Environment and deployment

- The git repository is the root folder (`github.com/trutzzi/fap`, branch `main`). The root-owned `front-end/front-end/.git-angular-cli-unused` is an empty leftover from `ng new`; it is ignored, and the user can delete it with sudo.
- PostgreSQL 16 runs locally via Homebrew. The back-end `.env` points at the `fight_academy` and `fight_academy_test` databases.
- **Lockfiles must be written by npm 10 (Node 22, `.nvmrc`)**, the versions CI uses. This Mac runs Node 25 / npm 11, whose lockfiles fail CI's `npm ci` ("not in sync", "Invalid Version"). Run `npm install` / `npm update` with Node 22, and fix advisories with a targeted `npm update <pkg>`. CI's `npm audit --omit=dev --audit-level=high` gate blocks the deploy.
- `~/.npm` (the npm cache) contains root-owned files until the user runs `sudo chown -R 501:20 ~/.npm`. Until then, pass `--cache <other dir>` to npm.
- **Production:** https://fap.valentintruta.ro, deployed by the `images` and `deploy` jobs in `.github/workflows/ci.yml` on every push to `main`. The stack (`deploy/docker-compose.yml`, in `~/fap` on the server as user `deploy`) shares the server with other apps: the albumflow Caddy container proxies to it over the `albumflow_default` network (block in `deploy/Caddyfile.fap`). Don't publish ports, and don't touch the other stacks. See the README's Deployment section.
