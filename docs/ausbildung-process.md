# The written Ausbildung process and the portal

Medcity's Ausbildung guide runs to nineteen steps across five desks: the
counsellor, documentation (a documentation mentor and a student mentor who is
the language specialist), placement, visa and the travel desk. Each step has a
turnaround ("T+7" is seven days). This note sets the guide against what the
portal does for an Ausbildung file, says what was added to close the gaps, and
says plainly what stays with people.

The map from statuses to the guide's steps, the turnarounds, the payment
milestones and the hand-over addresses all live in one place,
`src/lib/ausbildung.ts`, and the tracker, the student's Ausbildung tab, the
tests and this note read from it.

## What the portal had

| Guide | Portal, before this change |
|---|---|
| Steps 1 to 3: enquiry, registration, document collection | Enquiries, student registration with branch, counsellor and Medcity ID; a documentation checklist by journey (passport, photo, marksheets, German certificate, CV, motivation letter, work experience, birth certificate). The counsellor's registration fields (parent's number, German level, gap, batch type, amount paid) are on the profile and the Income tab. |
| Step 5: German language training | The German record, A1 to B2, one row per level with its date; the status "German A2 / B1 pending". |
| Step 6: document preparation and translation | The status "German CV and profile in progress" only. No translated or notarised certificates, no German CV as its own document, no self-introduction video. |
| Steps 7 and 8: language assessment, interview preparation, mock interview | Nothing. |
| Step 9: profile submission, employer shortlists | The status "Employer matching" and the application-submitted date on the Ausbildung tab. No shortlist. |
| Step 10: employer interview | The status "Employer interview scheduled" and the interview date and employer on the Ausbildung tab. |
| Step 11: training contract | The status "Training contract signed", the contract date and employer, and the training contract as a document at the Offer stage. No school contract, EZB, language confirmation, vaccination certificate or police clearance. |
| Step 12: pre-visa documents | The visa form and the visa appointment letter, shared with every journey. None of the rest of the list. |
| Steps 13 to 15: appointment, processing, approval | The statuses "Visa filed (VFS)" and "Visa received". Nothing between them. |
| Steps 16 to 19: pre-departure, departure, follow-up | The status "Joined employer"; the departure checklist (ticket, insurance, accommodation, forex card, SIM, briefing) and the arrival checklist (residence permit, local address, bank account) shared with every journey. No pre-departure or follow-up status. |
| Turnarounds | Lane-level SLAs in Settings (new, pending partner, in progress, offer, hold). Nothing per step; the status definition has no days field. |
| Payments: registration fee, 50% before interview readiness, 80% at the contract, 100% before the visa | The service charge as a line on the Income tab, with what came in and what is pending. No milestones. |
| Hand-over addresses | A Contacts list by area, editable under Admin. None for Ausbildung. |

## What was added

**Statuses.** Eleven statuses, so the chain now records every step the guide
names. The nine codes applications already point at are unchanged, label and
code; the new ones carry the guide's wording and slot in between them:

| Order | Code | Label | Group | Guide step |
|---|---|---|---|---|
| 10 | LANGUAGE_PENDING | German A2 / B1 pending | NEW | 5 |
| 20 | PENDING_PARTNER | Pending from partner | PENDING_PARTNER | any |
| 22 | DOCUMENT_COLLECTION (new) | Document collection by the counsellor | NEW | 3 |
| 24 | MENTOR_ASSIGNED (new, milestone) | Mentor assigned | IN_PROGRESS | 4 |
| 26 | DOCUMENT_PREPARATION (new) | Document preparation and translation | IN_PROGRESS | 6 |
| 30 | PROFILE_CV | German CV and profile in progress | IN_PROGRESS | 6 |
| 33 | LANGUAGE_ASSESSMENT (new) | Language assessment and interview preparation | IN_PROGRESS | 7 |
| 36 | MOCK_INTERVIEW_PASSED (new, milestone) | Mock interview passed: ready for employers | IN_PROGRESS | 8 |
| 40 | EMPLOYER_MATCHING | Employer matching | IN_PROGRESS | 9 |
| 43 | PROFILE_SUBMITTED (new, milestone) | Profile submitted to German employers | IN_PROGRESS | 9 |
| 46 | EMPLOYER_SHORTLISTED (new, milestone) | Employer shortlisted the candidate | IN_PROGRESS | 9 |
| 50 | EMPLOYER_INTERVIEW | Employer interview scheduled | IN_PROGRESS | 10 |
| 60 | CONTRACT_SIGNED | Training contract signed | OFFER | 11 |
| 70 | RECOGNITION | Recognition / approval in progress | IN_PROGRESS | 11 |
| 75 | PRE_VISA_DOCUMENTS (new) | Pre-visa documentation | IN_PROGRESS | 12 |
| 80 | VISA_FILED | Visa filed (VFS) | IN_PROGRESS | 13 |
| 85 | VISA_PROCESSING (new) | Visa processing | IN_PROGRESS | 14 |
| 90 | VISA_RECEIVED | Visa received | SUCCESS | 15 |
| 95 | PRE_DEPARTURE (new, milestone) | Pre-departure process | SUCCESS | 16 |
| 100 | JOINED | Joined employer | SUCCESS | 18 |
| 105 | HAPPY_CALL (new) | Destination Germany: happy call | SUCCESS | 19 |

The hold and closed statuses follow, as before. A new Ausbildung application
still starts at "German A2 / B1 pending". The new statuses have no Malayalam
yet; the student portal shows the English until somebody adds it on Status
flows. The status definition has no days field, so the guide's turnaround is
not stored on the status; it is read from the map in code and shown beside the
status (below).

The two new SUCCESS codes were added to every place that counts "visa received
or later" and "enrolled or later" (dashboard tiles and charts, insights,
targets, the application list's KPI filter, the desk's work view, commission
accrual), so a file moved on to pre-departure or the happy call still counts as
a visa.

**Document types and stage requirements.** Eighteen document types, and
twenty-three Ausbildung requirements placed on the stages the documentation spine
already has (registration paper on Profile, what the mentor prepares on
Application, what comes with the contract on Offer, the pre-visa list on Visa).
A document the employer sends (EZB, school contract, language confirmation,
accommodation proof, ZAV, annex employment data) is owed by Medcity, because
the placement team is who the portal waits on for it. Every row lands in
`document_requirements`, where the team edits it under Settings.

| Stage | Added for Ausbildung |
|---|---|
| Profile | Consultancy agreement (declaration form), Aadhaar and PAN card, diploma and degree certificates where held. The CV row now asks for the student's own resume. |
| Application | CV in German format (Lebenslauf), educational certificates in German translation, notarised and attested certificates (if required), self-introduction video, job-specific consent (declaration form, on shortlisting). |
| Offer | School contract, EZB (declaration of employment relationship), language confirmation letter from the employer, vaccination certificate and police clearance where the employer asks. |
| Visa | Accommodation proof, health insurance, biometric photo (35 x 40 mm), legal representation form, cover letter, annex employment data, ZAV approval, fast-track form. |
| Departure | Testimonial and felicitation record. |

Two notes on the guide's list. The guide names "Declaration of employment
relationship" and "EZB" separately; they are the same form (Erklärung zum
Beschäftigungsverhältnis), so there is one type for it. The guide names the
declaration form three times (registration, shortlisting, visa); the portal has
one type for the consultancy agreement and one for the job-specific consent,
and the visa file reads the two already on file. Documents here are PDFs and
images up to 10 MB, so the self-introduction video is recorded as a one-page
PDF carrying the link, and the row's guidance says so.

The documents the guide names that the portal already asked for every journey
(passport, photograph, marksheets, visa form, visa appointment letter, ticket,
insurance, SIM, forex card, briefing, residence permit, local address, bank
account) were left as they were.

**Payment milestones.** The four milestones from the guide are one constant
(`AUSBILDUNG_PAYMENT_MILESTONES`). The student's Ausbildung tab shows them
under the service charge with the amount each needs, worked out from the charge
raised, and marks each met, due now (by the step the file is at) or later. The
tracker's service-charge cell shows the percentage paid and the milestone the
guide expects at the file's step. The registration fee has no figure in the
guide, so none is shown for it. Nothing here moves money or blocks a status.

**The placement tracker.** A "Desk and step" column reads the open Ausbildung
application's status back to the guide's desk and step, with the days the file
has sat there against the guide's turnaround ("guide: T+7"), in warning colour
when over. A "Desk" filter narrows the list to one desk's files. A panel under
the table lists the hand-over addresses. The student's Ausbildung tab has a
card placing the file on the six desks, with the same turnaround line.

**Turnaround follow-through.** Once a morning (`POST /api/cron/ausbildung`,
9:01 AM IST from `.github/workflows/schedules.yml`) the portal looks for every
open Ausbildung application whose current step has run past the guide's
turnaround, by the same arithmetic as the tracker's cell (`tatOverdue` in
`src/lib/ausbildung.ts`, read off `applications.status_changed_at`). For each
it raises one follow-up task on the desk that owns the step and tells that
desk, naming the student, the step and the days over, with a link to the
application. Who owns a step is `tatOwners`: the documentation desk roles for
the documentation and language steps; the application team leader and the
admins for the placement, visa and travel steps; the student's counsellor and
the branch head for the counselling steps. The task goes to the officer
carrying the file where they are on that desk, else the first of the desk, or
the counsellor at a branch. Once per stay in a step: the task carries a key
(`ausbildung-tat:<application>:<step>:<status entered at>`), and a file with a
turnaround task raised since it entered its current status is skipped, ticked
off or not, so nobody is nagged daily. A move to another status starts a new
stay. A run looks at 200 files at most, oldest first; the rest wait a day.
Steps whose turnaround depends on something else are never late. The tracker
has an "Over turnaround" filter and a tile with the count, and the
documentation desk's dashboard shows the count while it is above zero. No
schema change: the follow-ups are rows in `tasks` and `notifications`.

**Hand-over addresses.** The four addresses the guide names are seeded as
Contacts under the area "Ausbildung (Germany)" (ausbildung@miak.in,
translation.germany@miak.in, placementassistant@miak.in and, one level up,
regionalhead.south@miak.in), where admins edit them. The tracker shows the
list, and falls back to the guide's own addresses on a database the SQL has not
reached. The portal sends nothing to these addresses; the desk does.

**Reaching production.** Statuses, document types and requirements are seeded
content, and the seed only runs on a fresh database. `deploy/ausbildung-process.sql`
(generated by `scripts/ausbildung-process-sql.ts`) inserts each status, type,
requirement and contact only where it is missing, so it is safe to run twice
and never overwrites a label, an order or a requirement the team has edited.
One guarded update changes the Ausbildung CV row's guidance, and only while it
still carries the seed's first wording. No schema change was needed.

## What is left for people

- The hand-over emails themselves, with the branch head and the regional head
  in copy. The portal lists the addresses; it does not send to them.
- Assigning the mentor and telling the counsellor and the candidate. The status
  records it; the people on a student's file is where to name the mentor.
- The Saturday language assessments, the grouping (excellent, good, average,
  poor) and the interview readiness report. The portal has no grading field for
  them; the status and a comment carry the outcome.
- The translation itself and the language specialist's check of it. The
  requirement and its guidance name the address; the files come back as
  documents.
- The compensation for dishonouring a contract, the refund policy and the
  batch type (premium or signature). These are in the consultancy agreement,
  not fields on the student.
- The turnaround per step. It is shown from the guide, not stored on the
  status, because the status definition has no days field and inventing one
  was out of scope. If the team wants to edit it, that is a schema change
  (a `tat_days` column on `status_definitions`) and a line on Status flows.
- Flight, accommodation, SIM, travel card and airport pick-up are services on
  the Services tab, as for every journey; the pre-departure status says the
  desk is on them.
- Malayalam for the new statuses and document types.
- A video upload. Documents are PDFs and images; the self-introduction video
  is a link in a PDF until that changes.
