# The written FSJ / BFD process and the portal

FSJ (Freiwilliges Soziales Jahr) and BFD (Bundesfreiwilligendienst) are two
pathways with one written process: 18 steps across five departments (Counsellor,
Documentation, Interview and Employer, Visa Team, Travel Desk), four decisions,
13 required documents and an email matrix. This note says how the portal carries
that guide and what stays with people.

Everything the guide fixes lives in one place, `src/lib/fsj.ts`: the steps and
their owners, the statuses each step means, the three hand-overs, the decision
rules, the checklists of steps 15 to 18, the email matrix and the student's
plain-words line per step. The tab, the tracker, the actions, the tests and the
deploy SQL all read it.

## Pathways

`FSJ` and `BFD` are values of the `pathway` enum, offered wherever a pathway is
picked: registration (the aim on the student form), enquiries and their routing
rules, the public form, sub-agent referrals, the catalogue (programs and the
program search chip), document requirements, the status dictionary, the queue,
the lists' filters, the checklists page, learning resources and Insights. The
programme facts (FSJ 18 to 26 years and 6 to 12 months; BFD 18 and over with no
upper limit and 6 to 12 (18) months; both B1 / B2) are shown on the tab as
information, from Medcity's programme sheet. Nothing checks a student against
them.

An FSJ or BFD application is started like any other, from the Applications
tab, on a course whose pathway is FSJ or BFD. The head office adds those
courses in the catalogue (Programs, New): the guide names no institution, so
none is seeded.

## Statuses

One chain, seeded for each pathway (`STATUS_SEED.FSJ` and `.BFD` in
`src/db/statuses.ts`), every status placed on a step. Codes the dashboards
already count (`VISA_FILED`, `VISA_RECEIVED`, `PRE_DEPARTURE`, `JOINED`,
`HAPPY_CALL`) are reused, so an FSJ visa counts as a visa everywhere.

| Step | Statuses |
|---|---|
| 2 Registration and agreement | REGISTRATION (where a new application starts) |
| 3 Document collection | DOCUMENT_COLLECTION |
| 4 Document cross-check | DOCUMENT_CROSS_CHECK |
| 5 Language assessment | LANGUAGE_ASSESSMENT |
| 6 Payment check | PAYMENT_CHECK, APPLICATION_ON_HOLD (hold group) |
| 7 Interview preparation and language improvement | LANGUAGE_IMPROVEMENT, INTERVIEW_PREPARATION |
| 8 Interview scheduling | INTERVIEW_SCHEDULED |
| 9 Interview and employer feedback | INTERVIEW_ATTENDED, SECOND_ROUND |
| 10 Employer confirmation and contract | EMPLOYER_CONFIRMED, OFFER_RECEIVED, CONTRACT_SIGNED |
| 11 VFS slot booking | VFS_SLOT_BOOKING |
| 12 Visa document preparation | PRE_VISA_DOCUMENTS, VISA_RESUBMISSION |
| 13 Visa submission at VFS | VISA_FILED |
| 14 Visa processing | VISA_PROCESSING |
| 15 Visa approval | VISA_RECEIVED |
| 16 Pre-departure | PRE_DEPARTURE |
| 17 Departure | JOINED |
| 18 Post-arrival follow-up | HAPPY_CALL |

The common statuses (pending from partner, on hold for the intake, deferred,
closed, visa rejected, withdrawn) follow, as for every pathway. No Malayalam
yet: the portal shows the English.

## The tab and the decisions

The student's FSJ / BFD tab places the file on the 18 steps, says who owns the
step, and shows the form for the step in hand to the department that owns it.
Every form posts to one action (`fsjStepAction` in `src/server/fsj-actions.ts`),
which checks the person may open the student and may record this step
(`mayDo`), writes the fields on the application through `updateTracked` (so
the History tab has every change), keeps the moment in `fsj_events`, moves the
status through `changeStatus` and tells the department that has the file next.

- **Language assessment (step 5).** The level and the result are recorded as
  the team enters them. The guide has not set a minimum, so the portal applies
  no pass mark. Not sufficient sends the file to improvement classes (step 7);
  it is re-assessed from there, and every assessment is kept.
- **Fees (step 6).** The payment check starts the application only when the
  registration and application fees are both paid; otherwise the file is on
  hold and the counsellor and branch head are told. The same gate stops any
  status move onto a started-application status, from any screen. When the
  fees come in, the documentation team is told to start it. Where the student
  has a fee plan with instalments on the FSJ / BFD steps (see "Fees" below),
  each fee is paid when its invoice is paid in full; otherwise the branch marks
  the day it was paid on the tab.
- **Interview (steps 8 and 9).** Scheduling needs the application started and
  the latest assessment sufficient, and records the employer, date and time,
  link, responsibilities and requirements. Feedback is positive, a second round
  (with the same employer) or not selected. Not selected is handled as the
  guide drafts it: the feedback is shared with the counsellor, the file goes
  back to interview preparation, and that employer is not offered again.
- **Offer and contract (step 10)**, then the hand-over to the visa team.
- **Visa (steps 11 to 15).** The VFS slot, the file made ready (only with the
  pre-visa payment in), the submission, and the decision: approved, or refused
  with its reason, corrected and resubmitted if the employer still wants the
  candidate, closed as visa rejected if not.
- **Travel desk (steps 16 to 18).** The guide's checklists, the departure date,
  and the follow-up, which starts with the happy call.

## Fees

Student fees can wait on the FSJ / BFD steps (`src/lib/fee-steps.ts`, pathway
`FSJ_BFD`, shared by both programmes): an instalment falls due when the file
reaches its step or any later one. The "FSJ and BFD, Germany" starter fee plan
is tied to the steps its fee sheet names, with the sheet's amounts: the
registration fee at registration (step 2), the application fee at the payment
check where the application starts (step 6), the offer-letter stage at the
offer and contract (step 10) and the pre-visa payment at visa document
preparation (step 12), where it is verified before VFS.

With such a plan, the tab's Payments card, the registration step, the fee gate
and the pre-visa check read the student's fee invoices (`src/lib/fsj-fees.ts`):
a stage is paid on the day its invoice is paid in full. A stage the plan has no
instalment for, and every stage of a student without one, keeps the day marked
paid on the tab.

## Hand-overs and the ledger

Three hand-overs move the file between departments: the branch to
documentation (gated on the profile documents and the details the guide
lists), documentation to the visa team (on the signed contract), and the visa
team to the travel desk (on the joining date). The first marks the application
handed over, which opens the file to the documentation team and is written to
the ownership ledger by `updateTracked`; the other two append a hand-over entry
to the student's ledger line.

## Emails

The portal sends no email. Each trigger in the guide's matrix raises a notice
in the portal to the people it names who can open the student, and the tab
shows, for each trigger, the addresses the guide says to email and copy (the
registration addresses come from the Contacts list, area "FSJ and BFD
(Germany)"), whether the notice was raised, and a "Copy email text" button
with the draft. Staff send it from their own mail.

## Reaching production

`deploy/fsj-bfd-process.sql` (generated by `scripts/fsj-bfd-process-sql.ts`)
inserts the statuses for both pathways, the three new document types, the
requirements and the two contacts, each only where missing. Run it after the
migration that adds the pathways. Safe to run twice.

## Still for people, and open points

- The two "points to confirm" in the guide: the minimum language level, and
  the not-selected handling (implemented as drafted).
- The experience certificate and the driving licence are on the guide's list
  but asked for without holding the file up, since not every candidate holds
  one. To confirm with the head office.
- The emails themselves.
- Amounts for the payment stages: the guide gives none. The amounts are the fee
  sheet's, on the starter fee plan; without a fee plan only the days paid are
  recorded here.
- Malayalam for the new statuses, document types and the portal card.
