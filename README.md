# Medcity Overseas Portal

Study abroad application platform for **medcityoverseas.com**. Medcity Overseas (the processing team) works applications submitted by Medcity branches and sub-agents, for three pathways: university degrees, Ausbildung in Germany, and nurse registration.

This repository currently contains **Phase 0 basics and Phase 1 (core pipeline)** from the wireframe.

## What works today

| Area | Who | What |
| --- | --- | --- |
| Sign in and roles | All | Seven roles, each with its own powers, plus a free-text job title on every account. Partners only ever see their own organisation's data. |
| Dashboards | All | One address, five dashboards. Super admin sees the platform (accounts, access, storage, audit activity); Overseas admin sees the processing desk (lane health against SLA, own files, unassigned work, partner activity); Management sees outcomes (funnel, conversion rates, partner performance, twelve month trend); a partner owner sees the branch (KPI tiles, tier progress, team load, deadlines); a counsellor sees their own desk (what is waiting on them, unread student replies, their students). |
| Students | Partners, staff | List with filters, inline reassignment, archive / delete. Registration requires recorded consent. |
| Student file | Partners, staff | Three steps: **Profile** (personal, address, passport, academics, work, tests), **Applications**, **Documents**. Profile locks once the team starts working an application; partners send edit requests. Passport numbers are masked for counsellors and every reveal and download is logged. |
| Applications | Partners, staff | Create against the program catalogue with valid intakes only. Acknowledgement numbers like `144472/26-27`. List with 12 filters, pagination, CSV export (formula-injection safe). |
| Comments | Partners, staff | Two channels per application: **Team** (hidden from student) and **Student** (mirrored to WhatsApp). Attachments, and "File as" to turn an attachment into a typed document. |
| Pre-submission check | Partners see it, admins act on it | Passport validity for the whole course, English (IELTS / PTE, MOI fallback), OET grade, German CEFR level, backlogs, study gap, missing required documents. Admin can send every issue to the partner as one request. |
| Status flows | Admin | Separate status lists for Degree, Ausbildung and Nursing. Reasons required for closed / deferred. Milestones send the student a WhatsApp update. Editable in **Status flows**. |
| Work queue | Admin | Kanban by status group per pathway, oldest first, SLA breach highlighting, change status inline. |
| Programs | Admin | Catalogue with structured requirements. CSV import with preview and line-level errors before anything is saved; re-importing updates existing programs. Any single program can be edited in place, with its change history beside the form. |
| Partners and people | Admin, super admin | Invite branch or sub-agent with a one-time temporary password, set tier, seats and relationship manager, add or deactivate users. Seat limits enforced. Role changes, password resets and Overseas staff accounts are super admin only. |
| Audit log | Super admin | Every recorded action with who, when, which record and the details, filtered by person, action, record type and date, with CSV export. |
| Commission | Partners, staff | Rules per country, university or program (percentage of tuition or a flat fee) with the partner's share. A placement that reaches a visa or enrolment accrues its commission automatically, then moves expected, invoiced, received, paid to the partner. Management sees the same numbers read-only. |
| Wallet | Partners | The branch's account with Medcity: commission credits, bonuses and adjustments, running balance, payout requests, and the transfer once the Overseas team marks it paid. |
| Insights | Staff | Conversion grouped by partner, destination, university, pathway or officer, with offer and visa rates; median days to offer and to visa read from the status history; intakes ahead; which enquiry sources convert; earnings by destination; CSV export. Management reads the same page. |
| Learning resources | All | Library of guides, templates, policies, training and marketing material. Each item is a file or a link, tagged by pathway and destination, visible to the roles it is meant for. The Overseas team publishes, pins and retires items. |
| Student portal | Students | A login of their own at `/portal`, in English or Malayalam: their applications in student-facing wording, the milestones so far, the documents still needed with upload, and the message thread their counsellor reads. Team-only notes never appear, and the passport number stays masked. Invited from the student file with a one-time password; access can be switched off again. |
| Notifications | All | Bell with unread count, list, mark read. Raised on new applications, status changes, comments and WhatsApp replies. |
| WhatsApp | System | Outbound adapter (`console` for development, `meta` for WhatsApp Cloud API) and an inbound webhook that verifies Meta's signature and posts student replies into the Student channel. |

| Program search | All | Search the catalogue by keyword, destination, level, intake and English requirement, with quick filters. Pick a student and every row shows eligible, on track (including practice scores from Medcity's own test platform) or not yet, with the reason. Apply straight from a result. |
| Program and university pages | All | Every program has a page: campus, duration, intakes, the three fees, post-study work with the evidence behind it, entry requirements, documents, a fit check for any student and Apply. Every university lists its programs by level with a summary that warns when some carry no post-study work. A figure nobody has verified reads "Not recorded", never "free". |
| Shortlist | Partners, admins | Up to twelve programs per student, added from search or a program page and compared side by side on the student file with the student's fit. Read-only for management and the documentation team. |
| Australia from CRICOS | Admins | Every course Australia registers for international students (about 26,000 from 1,500 providers), synced from the government's CRICOS register on data.gov.au with one button on the Programs screen, or from the three files uploaded by hand. Courses are keyed by CRICOS code, so each monthly release updates rather than duplicates; courses that leave the register are archived; anything added by hand is kept. Fees are the register's whole-course figures, shown as such. Post-study work follows the Home Affairs 485 rule: a degree of 92 or more registered weeks. |
| Scholarships | Admins publish, all read | Kept per university by the Overseas team with the amount as the institution words it, levels, eligibility, deadline and a required link to the institution's page. Shown on university and program pages; search filters by "Scholarship available". |
| Wider requirements | Admins set, all read | Besides IELTS, PTE, OET and German: TOEFL iBT and Duolingo (any named English test at its minimum will do), GRE, GMAT and SAT where required, and a minimum percentage in the qualifying study (12th for a bachelor's, the bachelor's for a master's). The fit check, "hide what the student cannot meet" and the pre-submission check all read them; a CGPA is never converted. |
| Deadlines and fee waivers | Admins set, all read | The last day to apply per intake and year, from the institution, with a note. Shown on the program page, in search ("apply by"), on a **Deadlines** page soonest first with the branch's students who shortlisted each program, and in the apply form, which warns when the intake's deadline has passed. A fee waiver is recorded in the words of whoever confirmed it; search filters by both. |
| Offer and visa | Team records, partners and students read | Per application: conditional or unconditional offer with its date, conditions and accept-by date; the deposit paid; the CAS, I-20, CoE or LOA number (named by destination); visa lodged, decision and date. Partners see a summary and are notified on each change; the student sees the offer and visa in the portal, in English or Malayalam. In the applications CSV too. |
| Commission in search | Partners, staff | The partner's expected share on each program, from the live commission rule that would pay (program, then university, then country): on search results, the program page and the shortlist comparison, with "Commission on offer" and "Highest commission first". A percentage rule on a program without a verified yearly fee shows its terms, never a figure worked out from a whole-course fee. Left out of the printed comparison and the student portal. |
| Student services | Partners ask, the team works | Education loans, forex, accommodation, insurance and flights, requested from a **Services** tab on the student file with a hint per service. The Overseas team works them from **Services** in the admin menu (open first, oldest first), names the provider and leaves a note; the partner is notified of each change. |
| Events | Team publishes, partners register | Webinars, university visits, training and fairs, with times in IST, a place or a join link, an optional university and a seat limit. Partners are notified when one is published, take a seat (which reveals the join link) and, where the event is open to students, register their own students. The team sees who is coming and can cancel. |
| Rankings and visa funds | Admins keep, all read | QS and THE rankings per university (as published, with the edition year), imported from a CSV with line-level errors; shown in search, on the universities index and the university page, with "best ranking first" and a top 200 / 500 / 1,000 filter. Each destination's student-visa living-cost figure, as its government states it and linked to the page, gives "funds to show for the visa" (first-year tuition plus living costs) on the program page. Both are kept on **Destinations and rankings**. |
| Help desk | Partners raise, the team answers | Tickets for what is not about one student's file: an application question, commission, a catalogue correction, access. A reply moves the ticket to whoever acts next and notifies them; tickets waiting on the team for two days or more are flagged; the team resolves or reopens. Each branch sees only its own. |
| Training | Team builds, partner staff take | Courses made of reading from the learning library and a multiple-choice quiz with a pass mark. Staff can retake; a pass gives a printable certificate (open to its holder, their branch head and the team). Branch heads see who in their team has passed what; the team sees every branch. |
| Program options | Partners ask, the team answers | A partner sends a student's profile (registered or not, with marksheets), destinations, levels and areas; the team finds programs, builds a list and sends it; the partner applies to any, or shortlists them all for the student in one step. Requests and replies sit side by side with a message thread; an unregistered student's request can be linked to their file later. |
| Updates and What's New | Team publishes, all read | Important updates from institutions and embassies, tagged by country, university and intake; announcements with a button; What's New in the portal. Partners are told about updates and announcements, see the latest announcement across their dashboard and updates by country (UK, AUS, CAN, US, other) in a dashboard card and on **Updates**; What's New carries a dot until opened. |
| Application deadlines | Team sets, both tick off | Typed milestones on each application (application, payment, CAS / I-20 / CoE request, offer acceptance, GS, enrolment, visa, course start), added by the team with a note; the partner is told. An offer's accept-by date becomes one by itself. Dashboards show them by Today / Tomorrow / 7 / 14 days, the applications list filters by type and date with a countdown, and **Deadlines** has a tab for them, overdue first. |
| Rupee estimates | All | Fees show a rough rupee figure ("≈ ₹21.7 lakh") from the indicative rates in Platform settings, in the student portal too, and only for currencies that have a rate. |
| Public enquiry form | Anyone with the link | A branch-specific form at `/apply/<slug>`, with no sign in: name, number, what they want and consent. Submissions arrive as enquiries owned by that branch with a follow-up due the next day. Opened per branch from Partners and people, which also prints the QR code for the counter. Protected by a honeypot field, per-caller and per-number rate limits, and a same-day duplicate check. |
| Enquiries | Partners, staff | Every walk-in, call, website form and referral before a student file exists. Owner, stage (new, contacted, qualified, in counselling, converted, lost), follow-up date with overdue highlighting, a history line per contact, and one click to register the person as a student, which closes the enquiry as converted. Partners see their own branch; the Overseas team sees every branch. |
| Password safety | All | Temporary passwords force a change on first sign in; sign in is rate limited per account and per caller. |
| Document storage | All | Supabase Storage in production, local disk in development. |

All four phases are built. Every nav item leads somewhere.

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

All seeded users share the password `Password@123`. Every person, university and number in the seed is fictional, apart from the super admin address, which is set with `SUPER_ADMIN_EMAIL` (default `sreejith@miak.in`).

| Email | Role |
| --- | --- |
| sreejith@miak.in | Super admin, platform owner |
| fathima.rahman@example.com | Student portal, opens in Malayalam |
| admin@medcityoverseas.test | Overseas admin, UK desk |
| ops@medcityoverseas.test | Ops manager |
| documentation@medcityoverseas.test | Documentation team |
| germany.desk@medcityoverseas.test | Overseas admin, Germany desk |
| nursing.desk@medcityoverseas.test | Overseas admin, Nursing desk |
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
| `npm test` | Unit tests (pre-submission rules, CSV import, formatting, the role matrix, commission arithmetic) |
| `DATABASE_URL=... npx tsx tests/db/eligibility-sql.ts` | Checks that the search filter for what a student can meet agrees with the per-row verdict on every program in that database |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Reset and load sample data |
| `npm run db:promote -- you@example.com` | Make an existing account a super admin (safe to run against production) |
| `npm run db:demo-off` | Switch off every sample `.test` account and scramble its password. Add `--delete-enquiries` to drop the sample enquiries too |
| `POST /api/cron/cricos` | Monthly CRICOS refresh for a scheduler, with `Authorization: Bearer $CRON_SECRET`. New courses land as drafts |
| `npx tsx scripts/sync-cricos.ts <folder> [--publish]` | Load the CRICOS register from its three downloaded CSVs (the admin screen does the same from data.gov.au) |
| `npx tsx scripts/supabase-part.ts <migration tag> "<title>"` | Write a migration as SQL that is safe to run twice in the Supabase SQL editor, with the migration recorded |
| `npx tsx scripts/cricos-reconcile-sql.ts > out.sql` | Write SQL that links hand-researched Australian programs to their CRICOS codes from the catalogue CSVs and removes any untouched draft twin a sync added |
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

### Two rules for server actions

- **No `loading.tsx` anywhere in the app.** A route-level loading boundary
  breaks two things. After a server action that revalidates, the refreshed page
  could arrive and never be applied: the save happened, the screen kept the old
  state (about one run in three for opening a branch's public form). And a link
  to the same page with other search params (a filter chip, a tab, the next
  page) could fetch the new page and never show it: search chips failed about
  half the time. Both went away with the skeletons.
- **No `redirect()` to the same page with other search params.** Return
  `redirectTo` in the form state and let `ActionForm` navigate. The redirect
  could leave the button on its pending label after the save.

## Security and data protection notes

- Every page and action loads records through org-scoped helpers (`getStudentForUser`, `applicationWhere`); partners get a 404 for other organisations' records.
- Only admins change application status, lock / unlock profiles, and manage programs, partners and statuses.
- Only a super admin creates or deactivates Overseas staff accounts, changes anyone's role, resets passwords, and reads the audit log. The role change refuses to leave the platform without an active super admin, and nobody can change their own role.
- Password resets issue a one-time password shown once in the confirmation, and the account cannot use the app until it is changed.
- Student consent text and time are stored on registration.
- Audit log covers profile edits, reassignments, status changes, passport reveals, document uploads, downloads and deletes, exports and imports.
- Uploads: PDF / JPG / PNG / WebP up to 10 MB, stored outside the web root, served with `no-store` and `nosniff`.
- In production the WhatsApp webhook refuses requests unless `WHATSAPP_APP_SECRET` is set.

## Before going live

- Run `npm run db:demo-off` so the seeded `.test` accounts (which all share one password) can no longer sign in.
- Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with a private `student-documents` bucket, so uploads survive a deploy (`src/server/storage.ts` falls back to local disk). Confirm it with `/api/health?probe=storage` signed in as an admin: it writes a file and deletes it again, and reports `probe.write: "ok"`. Either key style works, the legacy `service_role` JWT or a newer `sb_secret_...` secret key.
- Set `WHATSAPP_PROVIDER=meta` with approved message templates (free text only works inside the 24-hour window).
- Email the one-time password to the user instead of showing it to the person doing the reset.
- Move the sign-in rate limiter from process memory to Redis or the database once more than one instance runs.
- Email notifications alongside in-app ones.
- Set `TZ=Asia/Kolkata` on the server.
- Set `PUBLIC_BASE_URL` if the portal ever moves off `doc.medcityoverseas.com`: it is the address printed inside the branch QR codes.
- Set `COMMISSION_FX` (for example `GBP:115,EUR:98,AUD:60`) so the rupee estimate on foreign-currency commission matches your bank's rate. The figure entered when a partner's share is settled always wins.

## Deploying a schema change

The Hostinger build does not touch the database, so a migration is applied on purpose:

```bash
# from your Mac, with DATABASE_URL pointing at Supabase
npm run db:migrate
```

`drizzle/0002_super_admin_role.sql` adds `SUPER_ADMIN` to the role enum `drizzle/0003_enquiries.sql` adds the enquiry tables, and `drizzle/0004_commission_wallet.sql` adds commission rules, commissions, wallet entries and payout requests, and `drizzle/0005_resources.sql` adds the learning library, `drizzle/0006_public_form_and_student_login.sql` adds the public form and student logins, `drizzle/0007_malayalam_labels.sql` adds the Malayalam wording, and `drizzle/0008_ops_and_documentation_roles.sql` adds the ops manager and documentation roles. If you would rather do it in the Supabase SQL editor:

```sql
alter type "public"."role" add value 'SUPER_ADMIN';
update users set role = 'SUPER_ADMIN' where email = 'sreejith@miak.in';
```

Run the two statements separately: Postgres will not let a new enum value be used in the same transaction that added it.

## Roles

Set from **Partners and people**, along with a free-text job title ("UK desk", "Germany documentation") that shows beside the person's name everywhere.

| Role | Sees | Can |
| --- | --- | --- |
| Super admin | Everything | Everything below, plus creating other super admins and reading the audit log |
| Ops manager | Everything | Everything an Overseas admin can, plus adding and deactivating staff, changing roles and resetting passwords. No audit log, and cannot hand out super admin |
| Overseas admin | Everything | Process applications: statuses, work queue, programs, status flows, partners, commission, documents |
| Documentation team | Every student and application | Documents, the pre-submission check, asking partners for items, and both comment channels. No status changes, no commission, no accounts, no reports |
| Management | Everything | Read only: dashboards, applications, students, commission and insights |
| Branch head | Own organisation | Register students, apply, upload documents, answer requests, run the branch team, wallet and payouts |
| Counsellor | Own organisation | Same as a branch head, without full passport numbers, the team view or the wallet |
| Student | Their own file | The student portal only |

Who may hand out which role: a super admin can set any role. An ops manager can set every role except super admin. An Overseas admin can add partner staff but not Medcity Overseas accounts.

## Next

The public student registration form (QR) and student portal in English and Malayalam, the public student registration form (QR) and student portal in English and Malayalam, Medcity CRM lead sync, and the parent / sponsor view.
