# Medcity Overseas Portal

Study abroad application platform for **medcityoverseas.com**. Medcity Overseas (the processing team) works applications submitted by Medcity branches and sub-agents, for three pathways: university degrees, Ausbildung in Germany, and nurse registration.

This repository currently contains **Phase 0 basics and Phase 1 (core pipeline)** from the wireframe.

## What works today

| Area | Who | What |
| --- | --- | --- |
| Sign in and roles | All | Seven roles, each with its own powers, plus a free-text job title on every account. Partners only ever see their own organisation's data. |
| Dashboards | All | One address, five dashboards. Super admin sees the platform (accounts, access, storage, audit activity); Overseas admin sees the processing desk (lane health against SLA, own files, unassigned work, partner activity); Management sees outcomes (funnel, conversion rates, partner performance, twelve month trend); a partner owner sees the branch (KPI tiles, tier progress, team load, deadlines); a counsellor sees their own desk (what is waiting on them, unread student replies, their students). |
| Students | Partners, staff | List with filters, inline reassignment, archive / delete. Registration requires recorded consent. A branch registers into itself; the Overseas team is asked which branch, because a student filed against the head office belongs to nobody, and the branch is told when the desk registers one for them. |
| Student file | Partners, staff | Four steps: **Profile** (personal, address, passport, academics, work, tests), **Applications**, **Documents** and **Documentation**. Profile locks once the team starts working an application; partners send edit requests. Passport numbers are masked for counsellors and every reveal and download is logged. |
| Bulk upload | Branch owners and the team | Students, enquiries, application updates and commission payments from a CSV or Excel file, checked line by line before anything is saved. Students are matched by email, or by phone number and name where there is no email, and only blanks are filled in; a locked profile is left alone. A student with no email at all is kept on their phone number and cannot sign in to the student portal until an address is added. A whole name in one column is split at the last space; a single name with no surname is refused rather than guessed at. Consent comes either from a `consent` column or from one tick above the file, which stands for every row and is recorded against the person who ticked it, in the audit log and on each student. The team names the branch in a `branch` column, which takes the full name, the public code, or a word only one branch's name holds. Identical problems are gathered into one line with a count. |
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

| Program search | All | Search the catalogue by keyword, destination (one or several), level, intake and English requirement, with quick filters. Pick a student and every row shows eligible, on track (including practice scores from Medcity's own test platform) or not yet, with the reason. Apply straight from a result. |
| Vendors and routes | Admins keep, all read | The roads Medcity reaches a university by: its own agreements, KC Overseas, StudentOps360 and whoever comes next, each with a two-letter code and a colour that travel together on every screen. A route is one road to one course, carrying its own commission (a percentage of the first year or a flat fee), when it is paid and within how many days, its application fee, its offer turnaround, the course's code in the vendor's portal and what it asks for beyond the university's list. Recorded on a course by hand or from a vendor's sheet through the **Routes** bulk upload, which never creates a course. Search and the finder filter by route, or by "no route recorded" to find the gaps. A percentage is never applied to a whole-course fee, and a rate nobody has given reads "Not recorded". A course Medcity holds its own agreement on sorts above the vendor-routed ones in search, whatever the counsellor has sorted by, and its chip is marked "ours" so the reason is visible rather than implied. |
| The documentation spine | Partners, staff, the documentation team | Nine stages from Profile to Arrived, and the paper that gates each one. A student's list is built from five places at once: the stage itself, the destination, the route, the university and anything added for that student by hand, with a document asked for twice asked for once and every row saying where it came from. Each document is not needed, not asked, asked, uploaded, in review, accepted or sent back, and a rejection needs a reason from the team's own list, which is what the student reads. A file sent back keeps its version and its reason; the replacement is the next version. Expiry is read off the document (a TB test six months from its date, a test report two years) and measured against the course start, not against today, so a passport valid for four months against a two-year course counts as missing and says so. A requirement can be marked as one nobody may waive: the override stops being offered, and an admin who posts the move anyway is refused with the same words. Which ones those are is set on the requirements screen rather than written into the code. A branch can be set to do its own first pass: its staff then accept and send back their own students' documents, with the rule that nobody passes a file they uploaded themselves, and the desk reviews what the branch decided under "Checked by a branch" rather than checking all of it again. Off for every branch to begin with, and set per branch on the Partners screen. |
| Gates and overrides | Partners, staff | A stage cannot be left while a required document is missing, rejected or out of date, and the refusal names what is missing rather than being a bare error. An ops manager may let it through with a reason, which is logged and shown on the file. The apply screen names the same list before a course is chosen; whether it refuses the application outright is one switch in Platform settings, off to begin with, because a desk part way through a season has to collect the paper first. |
| Documentation queue | The documentation team, admins | One screen for the people who check paper all day: everything sent in and not yet decided, oldest first or visa stage first, filtered by branch, stage or route. Opening a document claims it for twenty minutes so two people never check the same bank statement, and the rule the team wrote sits beside the document while it is judged. Accepting reads the date off the document and records when it runs out; rejecting picks a reason and sends it to the student word for word. |
| Invoicing a vendor | Admins | The queue is grouped per vendor, because vendors settle in batches and an invoice per placement is an invoice nobody pays. A line becomes invoiceable once the milestone that vendor's own terms name has happened and has a date on it, never on a status alone: the queue says what each line is waiting for, and lines nobody has priced are named rather than quietly left out. One invoice covers as many students as the desk ticks, one currency at a time, numbered within the financial year with the database enforcing it. The total is the sum of the lines; there is no figure to type. |
| The invoice itself | Admins | A document that prints: the Medcity company that raises it with its address, PAN and GSTIN, the vendor it goes to, a line per student the vendor can match against their own file, the tax treatment in words, the total, and where to pay. Tax follows the company's own position: zero-rated as an export under a live LUT, taxable with a warning when the LUT has lapsed or is missing, IGST for an Indian vendor. A rupee figure is kept with the rate it was worked out at, because a rupee total without its rate cannot be checked against the bank. The portal does not email it: the desk attaches it and records that it has gone, which is when the ageing clock starts. |
| Payments, disputes and ageing | Admins | Each payment is its own row, so a part payment is never mistaken for the whole and nothing is overwritten. A student's line is marked received only when the whole invoice is, because a part payment cannot be split between students without inventing a figure. When an invoice is settled the branch's share of each commission becomes a wallet credit and the branch is told. A dispute is a state with a reason, not a failure, and stays on the ageing report until it is worked out. Ageing is by how late each invoice is, overall and per vendor, so who pays slowly comes from your own invoices rather than an impression. Writing an invoice off is a super admin's doing, with a reason, and every student's line on it says so. |
| Income per student | Admins and branch owners | Every kind of money one student brings in: service fee, commission, ticket, SIM, forex, insurance, accommodation, pickup, loan referral, coaching fee. Each line says who pays, what is expected, what has been invoiced, what has come in and the branch's share. Part payment is normal, so a line stays open until the whole of it is in. Totals are kept per currency rather than converted, so every figure matches the bank it came from. A line with no amount reads "Not recorded", is counted in no total, and the sheet says how many there are. Commission is read from the placement rather than copied, so the sheet and the commission screen cannot disagree. Follows the owner's switch that hides money from counsellors. |
| Rate cards | Admins set, branches read | What a branch charges or keeps per kind, as a flat amount or a percentage of the sale, with who pays and the branch's share, from a day. Empty to begin with, because nobody outside the Overseas team knows what Medcity keeps on a SIM and an invented figure is worse than none. Rates are added rather than edited, so a student priced last season can still be read against the rate that applied then. "Lay out the usual lines" prices a student's sheet from them, and still adds the kinds with no rate so the gaps are visible. |
| Money that stops being owed | Super admin only | Writing a line off needs a reason, stays on the sheet saying so, and is in the audit log. Nobody else can do it, because money that quietly disappears is how a branch's numbers stop meaning anything. |
| Leaving soon, and what was left on the table | Admins and branch owners | Students with a granted visa, soonest first, with what they have not bought beside them: one call each before they buy it somewhere else. Beside it, what was not sold at all, by kind and by branch. Only students who are actually going are counted, because a shortlist is not a missed sale. A booked service writes its own income line when the team marks it done, priced from the rate card, or with no amount where no rate exists. A student who says no is marked as having said no, which is not the same as a request somebody abandoned: the board stops asking and the leakage report stops counting them as money left on the table. SIM cards and airport pickups are services in their own right, so each can be booked and each writes its own income line. |
| What management reads on a Monday | Admins, management and branch owners | Four tables over one financial year: where the money came down (one row per vendor), what it was for, which branch sent the student, and which country pays. Days to pay is measured from the invoice going out to the money landing, as a median rather than an average, because one vendor who paid after four hundred days should not make a road look worse than every invoice on it. A branch owner sees only their own branch and is not shown the branch table. A column with nothing recorded behind it reads "Not recorded" and is counted in no total; lines in a currency other than rupees are left out and the number of them is stated, because adding them needs a rate nobody recorded. |
| My day | All | What is due, overdue first, then today. A task is on a person for a day, raised by hand or by the portal: a document a week old with no answer, a vendor gone quiet, a gate that has come clear and needs the next step taken. Tick it off, push it to tomorrow or next week, or finish it with a note. Each task says where it came from, so nobody wonders who asked. The portal's own tasks carry a key for the fact they stand for, so the same thing never lands on a desk twice however often the chasing runs. |
| Log a call in two clicks | Partners, staff | How they were spoken to (call, WhatsApp, visit, email, SMS), whether they called us, what came of it (spoke to them, no answer, they will send it, they want more time, wants to talk it through, not interested, wrong number) and what happens next. The outcome suggests the day to look again, which the counsellor can change. The next action becomes its own task, which is what makes the follow-up list build itself. |
| One timeline per student | Partners, staff | Every call, message, document, documentation decision, request to the student, status change, vendor reply, hand-over, stage move, task and payment in one feed, newest first, filterable to one kind. Assembled from what is already recorded rather than written twice, so there is no second copy of the truth to go wrong. Open tasks sit at the top rather than buried in it. |
| Students by stage | Partners, staff | The nine stages as columns, every student a card with who owns them, how long since anybody spoke to them, overdue tasks and how many applications they have. One click shows only the files nobody has touched in a fortnight. Filterable by branch and by counsellor. A student moves along on their own file, where the gate and its reasons are, rather than by dragging a card past the rules. |
| The hand-over | Counsellors, the Overseas desk | A counsellor builds the file and collects the paper; they are never asked which vendor it goes through. Once the documents for the application stage are in they hand it over, and what is missing is named rather than hidden behind a refusal. The desk picks the road, lodges it in that vendor's own portal, and records whatever comes back. A file can be sent back to the branch with a reason the counsellor reads, fixed, and handed over again. Where it sits reads in plain words on the application: with the branch, waiting for the desk, route chosen, lodged with the vendor, sent back. |
| What the vendor said | The Overseas desk | None of these portals tell us anything, so the desk types it in: an outcome from a list (acknowledged, more documents asked for, interview set, offer issued, conditions met, rejected, deferred, withdrawn), the day the vendor acted in their dates rather than ours, and their words. The outcome suggests the status to move to and the branch is told the moment it is recorded. The documentation team may move a status this way, because they are the ones reading the offer, but still not freely from the status screen. |
| The desk's queue | The Overseas desk | Everything the branches have handed over, oldest first, by step, branch, vendor or pathway, with the files whose vendor has gone quiet for a week findable in one click. Beside it, what each vendor actually takes: the median and the slowest from the day it was lodged to the day they answered, in their own dates, against the turnaround they quote. Only applications that have been answered count, so none of it is a guess. |
| Asking the student | Partners, staff | One screen with everything outstanding already ticked; untick whatever you will collect yourself. The message is built in English or Malayalam with the reason against each document and one portal link, and it is the counsellor's to edit before it goes: nothing is sent that a person has not read. Sent on WhatsApp where the student agreed and the branch allows it, otherwise into the portal only, with a day it is wanted by that lands on every row it covered. What went out is kept on the file, first asks and reminders together. |
| What the student sees | Students | "What we still need from you" on a phone, in English or Malayalam: only what they owe, the reason a document was sent back in the words the team picked, the date it is wanted by, and upload. An upload lands in review, never accepted: a student cannot mark their own document good, and the replacement is the next version while the refused one keeps its reason. |
| Chasing, without anyone remembering | System | A daily pass: three days of silence earns one reminder with the same list, shorter; at a week it stops being the portal's job and lands on the counsellor's desk, once; a rejection is repeated after two days with the reason again; anything that runs out inside sixty days of the course start is flagged, once; and a gate that comes clear is announced to whoever owns the next step. A student chased yesterday is left alone today. Admins can run the same pass by hand from the queue. |
| The submission pack | Partners, staff | Everything accepted for one application as one download: a front sheet naming the student, the route, the vendor's own number for the application, what is in the folder with versions and dates, what the vendor asks for beyond the university's list, anything running out too early, and what is still missing. Nothing is stored, so a pack built next week is the paperwork as it stands then; who built it, when, and what was missing at the time stay on the file. |
| Credit notes | Admin | Part of an invoice that turned out not to be owed, taken back off it with its own numbered document in its own series. A write-off says the whole invoice will never be paid; a credit says part of it was never owed, which is what a deferral after enrolment or a corrected rate actually is. Ticking the students sets the amount from their lines and writes those income lines back with the credit note's number on them. A credit can never exceed what is still owed, because the rest is a refund, which is money going the other way. The invoice is left as it was raised, since that is what the vendor has on file, and what is chased is the net. |
| Invoice counters and the ageing file | Admin | The tabs carry their own counts: what is ready to invoice, how many invoices are open, how many are late. The queue says what the ready lines come to, per currency rather than added together, and how many are waiting on a milestone or have no rate recorded at all. The ageing report downloads as a CSV, one row per open invoice with its bucket, days late, what was credited and what is left. |
| A reason when a road is changed | Desk | Choosing the first road needs no defence; moving off one moves the commission, the extra paperwork and who gets invoiced with it, so the desk is asked why and the file carries the answer where the next person will read it, not only in the audit log. |
| Search, one row per route | Staff, partners | A third view beside Programs and Universities: one line per road rather than one per course, so two aggregators on the same course can be read side by side with what each pays, how long their offers take and their own course code in columns of their own. Ordered by what the road pays Medcity in rupees at the indicative rates, so a cheaper currency does not win the sort, and a route with no rate recorded sorts last rather than first. Medcity's own agreements come first whatever the sort, and are marked as well as ordered. The route filter applies to the roads themselves here, not only to the courses they reach. |
| Pack rules per vendor | Admin sets, everyone gets | Each vendor records how they want a pack: a folder of files or one merged PDF, a file-name pattern over `{SURNAME} {GIVEN} {TYPE} {ID} {N}`, and the megabytes their system accepts. The screen says the shape and the names before anybody builds it, and a pack over the limit is refused with how much to take out rather than rejected at their end. Vendors who have said nothing get a numbered folder with no limit. |
| Sending something unchecked | Partners, staff | An uploaded document the desk has not accepted stays out of a pack unless somebody ticks it in deliberately, and then the front sheet marks it NOT CHECKED. Which rows were ticked is kept with the pack, so the same link rebuilds the folder that was sent rather than a tidier one. |
| What the team keeps | Admins, the documentation team | The nine stage lists, what each destination, route and university adds on top, the guidance and samples per document, and the reasons for sending one back, all on **Documents and requirements**. Editing a requirement changes every student's list as their file is opened and never touches a document already sent, accepted or refused. |
| The route on an application | Partners, staff | The program page compares every route to that course side by side: turnaround, fee, interview, what it asks for, and what it pays where commission is visible. The route itself is chosen by the Overseas desk once the documents are in, not by the counsellor at the point of applying; it is shown with its colour on the application, and the desk records the application's own reference in the vendor's portal. A student never sees any of it. |
| Course finder | All | Two ways in: one screen with every answer on it, or three questions that walk a counsellor through. The description can be typed in their own words and is read into the answers by the portal's own rules, with the AI, where the team has switched it on, only picking from the lists the portal supplies; a CGPA is never turned into a percentage and no figure is ever read out of the AI. The course box offers the catalogue's own course names and study areas as they are typed. Matches come back with the reasons they are there and the cautions against them, marked a strong match, worth a look or a stretch, beside a panel that narrows them with a count against every university and level, and sorts by fit, tuition, ranking, offer turnaround or name. A course up to a quarter over the budget is shown and marked, never dropped in silence. Shortlist, compare, or hand the same filters to search. |
| Offer turnaround | Team records, all read | How long an institution has been taking to answer, in days, from the Overseas team's own files. Set on one program, on every program a filter matches, or in the programs CSV as `offer_tat_days`. Shown on the finder's rows and the program page, filterable ("within 5 days") and sortable, and it counts towards a match. Nothing is recorded means "Not recorded", never a guess. |
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
| Medcity ID | All | One number per student, minted at registration and never changed: `MC-KOT-26-0041` is the forty-first student Kottayam registered in 2026. The serial restarts each January, per branch, from a counter in the database, so two counsellors registering at the same second cannot be handed the same number. On the student's header, under their name in the list, in their own portal, and findable in the search box however it is written down ("mc ktm 26 41"). The branch's letters are derived from its name and can be changed until the first student carries them. |
| The student's journey | Students, parents | The portal opens on the nine stages: which step of nine the file is on, what is happening now in English or Malayalam, what is still wanted with the day it is wanted by, and the dates to keep (documents due, offer accept-by, course start, a visa decision awaited), nearest first, with what has gone past kept rather than hidden. |
| Family access | Partners and the team give, parents read | A parent, guardian or sponsor gets a sign-in of their own at **Family view**: the same nine stages, what is still wanted from the student, the dates, and the branch to ring. They change nothing, send no messages and cannot open the files; fees are off unless switched on per person, and never show what Medcity earns from a university or a vendor. Four at a time per student. Removing access strands the session on the next click and leaves the row with a date on it. The student is told on WhatsApp in their own language whenever somebody is added, and their own **My details** page lists who can read their file. |
| Sub-agents | Anyone applies, the desk approves | A public form at `/join` where somebody asks to work with Medcity: a name, a number and a few lines about what they do, with the same guards as the public enquiry form (a honeypot, a limit per caller and per number, and the same number twice treated as the same application). The desk picks an application up so two people do not both ring them, then approves it, which creates the organisation, its first login and a one-time password shown once to read out, under whichever branch recruited them. The form can be shut from the Agreement tab when the desk cannot keep up. |
| The agreement | Super admin writes, the sub-agent accepts | A memorandum kept as versions rather than one editable page: a sub-agent accepted particular words on a particular day, and a new version is published beside the old one rather than over it. Accepting it asks for a typed name and a tick, and keeps who pressed it, the name, the day and where from. The page says plainly that this is a record of acceptance and not a signature in law. Publishing a new version asks every sub-agent again, and the desk sees who has not. |
| Referrals | Sub-agents send, the desk routes | A sub-agent sends a lead with a name, a number and whatever else they know, having confirmed the person agreed to it. It lands with the head office as an enquiry, and the desk gives it to a branch; ownership moves, the referrer does not, because the referrer is who gets paid. The sub-agent's own page shows the stage in words a family would understand and who is holding it, and nothing else: no documents, no notes, no fees, nobody else's leads. When the branch registers the lead, the student file carries the referrer and the earning is opened the same day. |
| Referral fees and withdrawal | Admins set, sub-agents withdraw | A rate per sub-agent or one platform default, added rather than edited so an old figure can be read back, as a share of the commission Medcity received or a fixed amount per enrolment. Both figures start unset, so a referral reads "Not recorded" rather than nought, and the desk has a list of earnings nobody has priced. An earning becomes payable, and the wallet credited, only when Medcity's own money is in: a commission marked received or a vendor invoice paid, guarded so neither path credits twice. A withdrawal is asked for from the same wallet a branch uses, against four conditions shown in full rather than one refusal at a time: the agreement accepted, bank details and PAN on file, any minimum met, and nothing already waiting with the desk. |
| The CRM link | Super admin sets up, the CRM calls | Medcity's own CRM registers students into the portal, looks one up, and sends leads in, over three documented endpoints. A key identifies the caller; it may send the secret as a bearer token to start with, or sign the body, which is switched on per key without a new key or a deploy. An `idempotency-key` makes a retry after a timeout safe: the same call twice is answered from the first one rather than registering the student twice. Going the other way, the portal queues what happens here (a stage move, an application's status, money, a document decision) and posts it to a URL you set, signed, with retries and a growing wait; a refusal the CRM meant is not retried but put in front of somebody. Every exchange both ways is on **The CRM link** under Platform, with what was sent and what came back, and a tab for what needs a person. The page the vendor builds against is there too, read from the same constants the code enforces, so it cannot go stale. |
| Which edit wins | All | The later one. The CRM sends its own `updatedAt` and it is required: without it there is no way to tell which edit is later, and a message from last week would undo a correction made this morning. Where the CRM's copy is older, nothing is written, every field it would have changed is named back in the answer with both values, and it goes on the queue for a person. A blank from the CRM never clears a value the portal holds, a field outside the agreed list is named rather than written, and every change is kept in the audit log with what it replaced, so a bad overwrite can be undone. |
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
| `POST /api/razorpay/webhook` | Razorpay's webhook for payment.captured, order.paid and payment.failed, signed with the webhook secret |
| `POST /api/cron/cricos` | Monthly CRICOS refresh for a scheduler, with `Authorization: Bearer $CRON_SECRET`. New courses land as drafts |
| `POST /api/cron/documents` | Daily documentation chasing, same header. Reminders at three days of silence, the counsellor's desk at seven, expiry flags and gate notices |
| `POST /api/cron/crm` | Drains the queue of events waiting for Medcity's own CRM, same header. Every few minutes. Without it the queue only moves when somebody presses the button on The CRM link |
| `POST /api/crm/students` | Medcity's CRM registers or updates a student. Keyed and optionally signed; see **For the vendor** on The CRM link |
| `GET /api/crm/students` | The same CRM looks a student up by its own id, the Medcity ID, an email or a number |
| `POST /api/crm/enquiries` | A lead from that CRM, before anybody has decided it is a student |
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
      students/                 list, new, [id]/profile | applications | documents | documentation
      documentation/            the documentation team's queue
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
    documentation-seed.ts       the nine stage lists and the reasons, as the team described them
    documentation-sync.ts       builds one student's list from the requirements
    seed.ts
  lib/
    auth.ts permissions.ts      session, role checks, org scoping, passport masking
    checks.ts                   pre-submission rules (pure, unit tested)
    journey.ts                  the nine stages, document states, gates, expiry (pure, unit tested)
    desk.ts                     the hand-over, vendor outcomes and real turnaround (pure, unit tested)
    crm.ts                      task headings, follow-up suggestions, the timeline's shape (pure, unit tested)
    income.ts                   the money arithmetic, rate cards and leakage (pure, unit tested)
    money-report.ts             the financial year, shares, medians and rupees in words (pure, unit tested)
    invoicing.ts                milestones, tax treatment, totals and ageing (pure, unit tested)
    ask.ts                      the message to the student, and the chasing schedule (pure, unit tested)
    pack.ts                     the front sheet, each vendor's naming and shape rules, the size check (pure, unit tested)
    program-import.ts           CSV parser (pure, unit tested)
  server/
    applications.ts             status changes, check loader
    desk.ts                     the desk's queue and what each vendor actually takes
    income.ts                   the sheet, the departure board and what was left on the table
    money-report.ts             the four Monday tables, counted in one window
    invoicing.ts                the invoice queue, one invoice, and the ageing report
    tasks.ts                    one person's desk, and the tasks the portal raises
    timeline.ts                 one student's story, assembled from what is recorded
    documentation.ts            the merged list, the gate, the team's queue
    documentation-reminders.ts  the daily chasing
    pack.ts                     gathers one application's accepted paperwork into the shape its vendor takes
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
- Razorpay: keys come from `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` when set, otherwise from Settings, Platform, where the two secrets are sealed with AES-256-GCM under a key derived from `AUTH_SECRET` (changing `AUTH_SECRET` means entering them again). The webhook at `/api/razorpay/webhook` refuses anything unsigned. Fees are charged in the program's own currency; nothing is converted.
- AI features (assistant, practice interviews, reading documents) use Anthropic's Messages API with `ANTHROPIC_API_KEY`, or a key sealed in Settings, Platform. They are off without a key and the owner's switch, count against a monthly allowance per branch tier, and never save anything a person has not checked. The assistant sees only the catalogue; interviews send the course, university, country and intake, never the student's name.
- A portal student opens only their own documents: what they uploaded and what the branch shared with them.

## The three scheduled jobs

Three endpoints need calling on a schedule, all with `Authorization: Bearer $CRON_SECRET`:

| Endpoint | How often | What happens without it |
| --- | --- | --- |
| `POST /api/cron/crm` | Every ten minutes | The outbound queue to Medcity's CRM only moves when somebody presses the button on The CRM link |
| `POST /api/cron/documents` | Daily, early morning IST | Nobody is chased for a document, no expiry is flagged and no gate notice goes out |
| `POST /api/cron/cricos` | Monthly | Australia's course register goes stale |

Pick one of these three places to call them from. The portal does not care which.

**From GitHub.** `.github/workflows/schedules.yml` in this repository does all three.
Add two repository secrets under Settings, then Secrets and variables, then Actions:
`PORTAL_URL` (`https://doc.medcityoverseas.com`) and `CRON_SECRET` (the same value as
in the portal's own environment). Nothing to install, and it survives a hosting move.
Two caveats: a scheduled run can be a few minutes late when GitHub's runners are
busy, and GitHub switches scheduled workflows off in a repository that has had no
pushes for sixty days. Both are fine for these three. Run one by hand from the
Actions tab to check the secret is right.

**From the host.** In hPanel, open the site's dashboard and find Cron Jobs, then add
a Custom command per job. Shared plans limit how often a cron may run, so check what
the panel offers before relying on ten minutes:

```
curl -fsS -X POST https://doc.medcityoverseas.com/api/cron/crm -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**From the VPS,** once the portal moves there. Either a scheduled task on the
application in Coolify, or plain `crontab -e`:

```
*/10 * * * * curl -fsS -X POST https://doc.medcityoverseas.com/api/cron/crm -H "Authorization: Bearer YOUR_CRON_SECRET" >/dev/null
30 3 * * * curl -fsS -X POST https://doc.medcityoverseas.com/api/cron/documents -H "Authorization: Bearer YOUR_CRON_SECRET" >/dev/null
0 4 1 * * curl -fsS -X POST https://doc.medcityoverseas.com/api/cron/cricos -H "Authorization: Bearer YOUR_CRON_SECRET" >/dev/null
```

Whichever is chosen, `CRON_SECRET` must be at least 24 characters. Shorter than that,
or unset, and all three endpoints answer 401 to everybody, which is deliberate: an
unset secret means the endpoint is off, not open to the world.

Every successful run writes a line to the audit log, so **Go live**, under *What is
still unset*, says when each job last ran and whether a scheduler is actually calling
it. A job that has not run within three times its own interval is called late there,
which is the only way to notice a scheduler that quietly stopped.

## What is still unset

Super admin, **Go live**, first tab. It counts what is actually in the portal every
time it is opened and lists what has not been set: rate cards and the billing company,
the document rules, Medcity IDs, the sub-agent agreement and referral rate, the three
schedulers, the CRM link, and what has to be true before real students arrive.

Three severities, and the difference is the point. *Needed* would mislead somebody or
lose work if real students arrived today. *Yours to decide* is a real question with no
wrong answer that only Medcity can settle. *Can wait* breaks nothing by being left.
Everything is listed, settled as well as outstanding, because a list of only the
problems leaves nobody sure the rest was looked at.

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

## What a sub-agent tells us about itself

The sign-up form at `/join` asks for the firm on paper (registered name,
registration number, GSTIN, PAN, address) and for the owner's proof of identity
(the kind, and the number on it). All of it is optional, because somebody
working in their own name has no company to describe and a blank is better than
an invented answer, but what is filled in is checked for shape before it is
kept: a GSTIN that cannot be a GSTIN, or one that does not carry the PAN given
beside it, is refused at the form rather than found at the first invoice.

The owner's number is held the way a student's passport is, and shown the same
way: the first and last characters on screen, the whole of it only to whoever
may already see a passport. Nothing here is verified by the portal. It is what
the applicant typed, shown on the Applications tab so the desk can check it
against the papers before approving anybody.

One thing for Medcity's own lawyer rather than for this portal: India's Aadhaar
Act limits what a private company may store of an Aadhaar number. Aadhaar is on
the list of proofs because people offer it, but PAN is the safer thing to ask
for, and dropping Aadhaar from the list is a one-line change if that is the
advice.

## Money in more than one currency

Nothing is ever converted. University commission is recorded in the vendor's own
currency, a service fee in rupees, and adding them would need a rate nobody
wrote down. So every total is kept per currency, the student's income sheet
shows one line per currency, and the Monday read has a currency picker: each
table reports one currency at a time and says so, which means every figure on
the page matches the bank it came from.

Coaching fees are the academy's money, not Overseas'. They stay on the student's
sheet, because they are part of what that student is worth to Medcity, and they
are counted in no Overseas total, because adding them would flatter every money
screen by an amount a different company earned.

## Whose students somebody sees

Two questions, in order, applied in SQL rather than filtered afterwards, so a
list, a count and a page of results can never disagree.

**Whose organisation.** The desk sees every branch; everybody else sees their
own. That has always been true.

**Whose students.** A role without "See every student" sees only the ones
assigned to them: the students they counsel, the applications they are the
officer on, and the documents they have claimed or checked. Out of the box that
means a counsellor, a trainee and a sub-agent's counsellor see their own
students, and the documentation team sees the files it has been given. A branch
head, a senior counsellor and the desk roles see everything in their scope.

Four things keep this workable. The documentation desk sees the files the
branches have handed it. Nothing in the portal assigns a student to a
documentation officer, because there is no such field and no screen that sets
one; what there is, is the moment a branch hands a file over, and from then the
desk works it. Without this the desk could reach nothing it had not registered
or claimed from the queue, which is a desk that cannot do its job. A student
never handed over stays the branch's own business.

Whoever registered a student keeps them,
whatever else is true: somebody at the head office registering a walk-in cannot
assign themselves, because the counsellor has to belong to the student's branch,
and without this they would watch the student they just typed in turn into a
404. A student nobody has taken on is visible to their own branch, because a
student no counsellor can open is a student nobody picks up. And the
documentation queue stays a pool: claiming a document from it is what makes that
file yours, so the queue is never full of work nobody can reach.

If it proves too tight, it is a tick on "Who may do what" rather than a deploy.

## The counsellor roles

"Counsellor" was doing the work of several jobs, so there are now five of them,
and what each may actually do is set on the screen below rather than written
into the code.

| Role | Sits | Sees |
| --- | --- | --- |
| Overseas desk counsellor | Medcity Overseas | Students across every branch, like the other desk roles. Advises rather than processes. |
| Branch head | One branch | Their branch: students, team, wallet, branch settings. |
| Senior counsellor | One branch | Their branch's students. Not the wallet, the team or the branch settings. |
| Counsellor | One branch | Their branch's students. |
| Trainee counsellor | One branch | Their branch's students, but does not start an application or write to a student: they build the file and somebody else sends it. |
| Sub-agent counsellor | One sub-agent firm | That firm's own students, under whoever signed its agreement. |

Scoping is by organisation, as it always was, so every screen that scoped a
counsellor scopes all of them. The trainee's two limits are capabilities, which
means a branch that wants its trainees to message students can simply turn that
on.

## Who may do what

Settings, **Who may do what**, super admin only. One row per thing somebody can
do (see money, accept or send back a document, read the invoice queue, raise an
invoice, see a whole passport number, read the audit log) and one column per
role.

Every box starts exactly where the portal already stood, and only the
differences are stored, so an empty table behaves identically to the portal
before the screen existed, and a default changed in the code still reaches any
portal that never overrode it. A box that has been moved says who moved it and
when.

Three things no tick can change. A super admin keeps everything, so nobody can
lock the last person out of the screen that would undo it. A student or a parent
gains nothing, whatever is written in the table. And the rules that exist for
reasons outside Medcity's choosing stay: nobody passes a document they uploaded
themselves, every reveal of a passport number is in the audit log, and a parent
sees what the student allows.

A branch owner's own switches, for whether counsellors see commission and
whether the branch checks its own documents, sit on top of this and can only
take away.

## Reading the audit log

Every action in the portal writes a row to `audit_logs`, so it is the
fastest-growing table here and the one that never shrinks. Two screens read it
on every view: the readiness tab asks when each scheduled job last ran, and the
audit screen shows the newest entries. Both are indexed for that, on
`(action, created_at desc)` and on `created_at desc`.

Measured against three hundred thousand rows, which the portal will pass in its
first couple of years: the scheduler check went from 19 ms to 0.1 ms, the "has
it ever failed" check from 22 ms to 0.04 ms, and the audit screen's own first
page from 77 ms to 0.13 ms. Filtering the audit screen by actor is still a scan,
about 30 ms at that size; it is left unindexed on purpose, because the index
would be paid for on every write in the portal to speed up a screen a super
admin opens occasionally.

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

## Every link and every button belongs to whoever is shown it

A role is never given a control that refuses it. Being shown a door and then
turned away by it is the worst of both: the person cannot tell whether they are
allowed, nobody told them, and with a form they have already typed their work
into it.

Two suites hold this. `tests/browser/nav.mjs` signs in as all thirteen roles and
presses every link in that role's own sidebar. `tests/browser/buttons.mjs` opens
the screens each role works on and presses the submit button of every form on
them, including the ones a locked profile would otherwise hide. Both fail on a
refusal, a 404 or a redirect somewhere else. Run them after touching a
navigation, a page guard or an action's role list.

## Roles

Set from **Partners and people**, along with a free-text job title ("UK desk", "Germany documentation") that shows beside the person's name everywhere.

| Role | Sees | Can |
| --- | --- | --- |
| Super admin | Everything | Everything below, plus creating other super admins and reading the audit log |
| Ops manager | Everything | Everything an Overseas admin can, plus adding and deactivating staff, changing roles and resetting passwords. No audit log, and cannot hand out super admin |
| Overseas admin | Everything | Process applications: statuses, work queue, programs, status flows, partners, commission, documents |
| Documentation team | Every student and application | Documents, the pre-submission check, asking partners for items, registering a student, and both comment channels. No status changes, no commission, no accounts, no reports |
| Application team leader | Every student and application | Everything the documentation team can, plus the whole desk's queue rather than their own, moving a file from one officer to another, setting what the desk chases, and letting a stage through with a reason. Their dashboard is the desk's standing, not the applications board |
| Management | Everything | Read only: dashboards, applications, students, commission and insights |
| Branch head | Own organisation | Register students, apply, upload documents, answer requests, run the branch team, wallet and payouts |
| Counsellor | Own organisation | Same as a branch head, without full passport numbers, the team view or the wallet |
| Senior counsellor | Own organisation | The branch's students rather than their own, with the branch's numbers. No wallet, no seats, no team: that is the branch head's job |
| Trainee counsellor | Own students | Builds the file; somebody else sends it. Their dashboard carries what they have built and cannot submit, so it is chased rather than waited on |
| Sub-agent counsellor | Own organisation | Works inside a sub-agent firm. Their dashboard carries what the firm has referred and earned, because that is how they are paid |
| Overseas desk counsellor | Their own students, every branch | Advises from the head office rather than a branch, so their dashboard is their own students with the branch named on each, and none of a branch's wallet, seats or tier |
| Student | Their own file | The student portal only |
| Parent or guardian | One student's file | The family view only: read the journey, what is outstanding and the dates. Changes nothing, and never opens a file |

A sub-agent is not a role. It is an organisation type: its people hold the same PARTNER and COUNSELLOR roles a branch does, and what makes them a sub-agent is that they refer leads to the desk and are paid per student, rather than working the students themselves. They get two screens a branch does not have, Referrals and Agreement, and a branch gets neither.

Who may hand out which role: a super admin can set any role. An ops manager can set every role except super admin. An Overseas admin can add partner staff but not Medcity Overseas accounts. A student's and a parent's sign-in are not roles anybody is promoted into: both are created from that student's own file, against one student, and nowhere else.

## Queued, not built

**A finance role.** There is none. Everybody who touches invoices today is an
Overseas admin or an ops manager, using the same login they use for everything
else, which is why "everyone except the finance team" could not be expressed
when it was asked for. A finance role would hold the invoice queue, credit
notes, the ageing report and the Monday read, and nothing else. Not started.

## Next

Everything in the wireframe is built. What is left is other people's work and
yours.

The CRM link is the portal's half. Medcity's own CRM is still being built by its
vendor, so nothing here assumes its shape: the portal states what it accepts,
sends **For the vendor** as the contract, and where events go is a setting rather
than code. When their side is real: make a key, give them the key id and the
secret, point the webhook at their URL, tick which kinds to send, switch it on,
and send a test event. Signing should be on before go-live.

Point a scheduler at `POST /api/cron/crm` with the cron secret, every few
minutes, or the outbound queue only drains when somebody presses the button.

Before sub-agents are let in: set the referral rate (Sub-agents, Sub-agents tab),
read the seeded agreement and replace it with the one your lawyer approves, and
decide the smallest withdrawal. The seeded memorandum is a plain-English draft
written for this build, not legal advice, and nobody should be asked to accept it
as it stands.

The new Malayalam lines (the nine stages, the dates card, the family view and
the notice a student gets when a parent is added) want a native speaker's eye
before they are read by families.
