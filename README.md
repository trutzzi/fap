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
