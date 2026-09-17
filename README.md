# Medcity Overseas Portal

Study abroad application platform for **medcityoverseas.com**. Medcity Overseas (the processing team) works applications submitted by Medcity branches and sub-agents, for three pathways: university degrees, Ausbildung in Germany, and nurse registration.

This repository currently contains **Phase 0 basics and Phase 1 (core pipeline)** from the wireframe.

## What works today

| Area | Who | What |
| --- | --- | --- |
| Sign in and roles | All | Admin, Management (read-only), Partner owner, Counsellor. Partners only ever see their own organisation's data. |
| Dashboard | Partners, staff | KPI tiles (all, offers, payments, visa received / rejected, non-enrolment, deferrals, pending from partner) with date, intake and country filters. Each tile opens a filtered list. Tier progress, upcoming deadlines, relationship manager. |
| Students | Partners, staff | List with filters, inline reassignment, archive / delete. Registration requires recorded consent. |
| Student file | Partners, staff | Three steps: **Profile** (personal, address, passport, academics, work, tests), **Applications**, **Documents**. Profile locks once the team starts working an application; partners send edit requests. Passport numbers are masked for counsellors and every reveal and download is logged. |
| Applications | Partners, staff | Create against the program catalogue with valid intakes only. Acknowledgement numbers like `144472/26-27`. List with 12 filters, pagination, CSV export (formula-injection safe). |
| Comments | Partners, staff | Two channels per application: **Team** (hidden from student) and **Student** (mirrored to WhatsApp). Attachments, and "File as" to turn an attachment into a typed document. |
| Pre-submission check | Partners see it, admins act on it | Passport validity for the whole course, English (IELTS / PTE, MOI fallback), OET grade, German CEFR level, backlogs, study gap, missing required documents. Admin can send every issue to the partner as one request. |
| Status flows | Admin | Separate status lists for Degree, Ausbildung and Nursing. Reasons required for closed / deferred. Milestones send the student a WhatsApp update. Editable in **Status flows**. |
| Work queue | Admin | Kanban by status group per pathway, oldest first, SLA breach highlighting, change status inline. |
| Programs | Admin | Catalogue with structured requirements. CSV import with preview and line-level errors before anything is saved; re-importing updates existing programs. |
| Partners | Admin | Invite branch or sub-agent with a one-time temporary password, set tier, seats and relationship manager, add or deactivate users. Seat limits enforced. |
| Notifications | All | Bell with unread count, list, mark read. Raised on new applications, status changes, comments and WhatsApp replies. |
| WhatsApp | System | Outbound adapter (`console` for development, `meta` for WhatsApp Cloud API) and an inbound webhook that verifies Meta's signature and posts student replies into the Student channel. |

| Program search | All | Search the catalogue by keyword, destination, level, intake and English requirement, with quick filters. Pick a student and every row shows eligible, on track (including practice scores from Medcity's own test platform) or not yet, with the reason. Apply straight from a result. |
| Password safety | All | Temporary passwords force a change on first sign in; sign in is rate limited per account and per caller. |
| Document storage | All | Supabase Storage in production, local disk in development. |

Nav items marked P3 / P4 are placeholders for later phases (wallet, commission, learning, insights). Enquiries is the remaining Phase 2 module.

## Design

Brand crimson and gold from Medcity's own identity, warm neutrals, Poppins for
headings and DM Sans for text. Status colours (amber, indigo, green, red) are kept
distinct from the brand red so a "closed" case never reads as chrome. Tokens live in
`src/app/globals.css`; shared components in `src/components/ui.tsx`.

## Stack

- Next.js 15 (App Router, server actions), React 19, TypeScript
- PostgreSQL 16 with Drizzle ORM and drizzle-kit migrations
- Tailwind CSS 4
- Auth: signed HTTP-only JWT cookie (jose) with bcrypt password hashes
- Zod validation on every server action

## Run it locally (Mac)

Requirements: Node 22 (`nvm use`), and either Docker Desktop or Postgres.app.

```bash
npm install
cp .env.example .env            # then set AUTH_SECRET: openssl rand -base64 48

# Database: Docker...
docker compose up -d
# ...or Postgres.app: create user "app" / password "app" and a database "study_abroad"

npm run db:migrate              # create tables
npm run db:seed                 # sample data (wipes existing data)
npm run dev                     # http://localhost:3000
```

### Sample accounts

All seeded users share the password `Password@123`. Every person, university and number in the seed is fictional.

| Email | Role |
| --- | --- |
| admin@medcityoverseas.test | Admin, UK desk |
| germany.desk@medcityoverseas.test | Admin, Germany desk |
| nursing.desk@medcityoverseas.test | Admin, Nursing desk |
| management@medcityoverseas.test | Management (read-only) |
| kottayam@medcity.test | Partner owner, Medcity Kottayam |
| uk.docs@medcity.test | Counsellor, Medcity Kottayam |
| germany@medcity.test | Counsellor, Medcity Kottayam |
| kochi@medcity.test | Partner owner, Medcity Kochi |
| owner@horizon.test | Sub-agent owner, Thrissur |

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (pre-submission rules, CSV import, formatting) |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset and load sample data |
| `npm run db:studio` | Browse the database |

## Project layout

```
src/
  app/
    login/                      sign in / out
    (app)/                      signed-in shell (top bar, side nav)
      dashboard/
      students/                 list, new, [id]/profile | applications | documents
      applications/             list
      admin/queue | programs | partners | statuses | applications/[id]/check
      notifications/
    api/
      documents/[id]            scoped, audited file download
      applications/export       CSV export
      whatsapp/webhook          Meta webhook (verify + inbound)
  components/                   UI primitives and form helpers
  db/
    schema.ts                   all tables and enums
    statuses.ts                 status dictionary per pathway + document types
    seed.ts
  lib/
    auth.ts permissions.ts      session, role checks, org scoping, passport masking
    checks.ts                   pre-submission rules (pure, unit tested)
    program-import.ts           CSV parser (pure, unit tested)
  server/
    applications.ts             status changes, check loader
    queries.ts                  shared filters and scoped loaders
    whatsapp.ts notify.ts storage.ts
drizzle/                        SQL migrations
tests/                          node:test unit tests
```

## Security and data protection notes

- Every page and action loads records through org-scoped helpers (`getStudentForUser`, `applicationWhere`); partners get a 404 for other organisations' records.
- Only admins change application status, lock / unlock profiles, and manage programs, partners and statuses.
- Student consent text and time are stored on registration.
- Audit log covers profile edits, reassignments, status changes, passport reveals, document uploads, downloads and deletes, exports and imports.
- Uploads: PDF / JPG / PNG / WebP up to 10 MB, stored outside the web root, served with `no-store` and `nosniff`.
- In production the WhatsApp webhook refuses requests unless `WHATSAPP_APP_SECRET` is set.

## Before going live

- Swap local file storage (`src/server/storage.ts`) for S3-compatible storage.
- Set `WHATSAPP_PROVIDER=meta` with approved message templates (free text only works inside the 24-hour window).
- Add password reset and forced password change on first sign-in (temporary passwords are shown once today).
- Add rate limiting on sign in.
- Email notifications alongside in-app ones.
- Set `TZ=Asia/Kolkata` on the server.

## Next: Phase 2

Program search with eligibility filters and LMS test readiness, enquiries, the public student registration form (QR) and student portal in English and Malayalam, Medcity CRM lead sync, and the parent / sponsor view.
