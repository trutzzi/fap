# FightAcademy Platform

Admin app and RFID check-in kiosk for the FightAcademy gym.

| Folder | What it is |
| --- | --- |
| `front-end/front-end` | Angular 21 app (UI in Romanian) |
| `back-end` | REST API: Express 5, PostgreSQL, Prisma 7 ([README](back-end/README.md)) |

## Getting started

Requirements: Node.js 22 or newer, and PostgreSQL.

```bash
cp back-end/.env.example back-end/.env   # set DATABASE_URL and TEST_DATABASE_URL
npm run setup                            # installs root, back-end and front-end dependencies
npm run db:migrate                       # creates the database tables
npm run db:seed                          # optional demo data
npm start                                # API on :3000, app on http://localhost:4200
```

Ctrl+C stops both. To work on the UI without a database, run `npm run start:mock`.

Other root scripts: `npm run build`, `npm test`, `npm run format`, `npm run db:studio`.

## Deployment

Every push to `main` runs `.github/workflows/ci.yml`:

1. **back-end** and **front-end** jobs run lint, format check, type check, tests (with a Postgres service) and the production builds.
2. **images** builds three Docker images and pushes them to GHCR: `fap-api` (the API), `fap-api-tools` (migrations and account scripts) and `fap-web` (the Angular SSR server). Each is tagged with the commit SHA and `latest`.
3. **deploy** connects over SSH to the server as `deploy`, pinning the server's host key. It copies `deploy/docker-compose.yml` to `~/fap`, then pulls and restarts the stack. Migrations run first, and the API only starts once they succeed. The job waits for the health checks and runs a smoke test on https://fap.valentintruta.ro.

**Server layout:** `~/fap/docker-compose.yml` is copied there by CI. `~/fap/.env` holds `POSTGRES_PASSWORD`; it exists only on the server, so never commit it. The database lives in the `fap_db-data` Docker volume.

**Reverse proxy:** the shared Caddy container (`/opt/albumflow/infra/caddy/Caddyfile`) contains the block from `deploy/Caddyfile.fap`. It reaches `fap-web` and `fap-api` over the `albumflow_default` network and handles HTTPS automatically.

**Repository secrets:** `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 <host>`).

**One-off commands on the server** (`cd ~/fap`):

```bash
docker compose run --rm migrate npm run user:create -- --email ana@club.ro --name "Ana Pop" --role admin   # asks for a password
docker compose run --rm migrate npm run user:password -- --email ana@club.ro
docker compose logs -f api web
docker compose exec db pg_dump -U fap fight_academy > backup-$(date +%F).sql   # backup
```

**Rollback:** run `IMAGE_TAG=<previous commit sha> docker compose up -d` in `~/fap`, or re-run an older deploy job from the GitHub Actions page.
