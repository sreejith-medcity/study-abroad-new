# The written Au pair process and the portal

Au pair (a year living with a host family in Germany) follows the owner's guide
"Au Pair Process Flow": 15 steps in five stages, carried by six teams
(Counsellor / branch team, Documentation department, Student mentor, Placement
team, Visa team, Travel desk), from the enquiry to the happy call after arrival.
It replaces the provisional status list Au pair had in 1.8.7. This note says how
the portal carries the guide and what stays with people.

Everything the guide fixes lives in one place, `src/lib/au-pair.ts`: the steps
and their teams, the statuses each step means, the four hand-overs, the
decisions, the gate before the visa appointment, the two document lists, the
checklists, the registration email and the student's plain-words line per step.
The tab, the tracker, the actions, the tests and the deploy SQL all read it.

## Built beside FSJ / BFD, sharing its storage

The process is built the way FSJ / BFD carries its guide (`docs/fsj-bfd-process.md`)
but as a module of its own (`src/lib/au-pair.ts`, `src/server/au-pair.ts`,
`src/server/au-pair-actions.ts`), not as a second process inside the FSJ / BFD
one. The two guides share an outline but not their rules (FSJ / BFD has the
language assessment, the two-fee gate, VFS, fee plans and written-off settling),
and folding both into one engine would have touched every FSJ / BFD rule. What
is shared:

- **Storage.** Every round is a row in `fsj_events` (new kinds: mentor, mock
  interview, profile submitted, host family, contract, appointment, follow-up;
  the interview, outcome, payment check, visa, hand-over and notice kinds are
  FSJ / BFD's). The facts are on the application, in the `fsj_` columns whose
  meaning is the same (registration fee, agreement, host family in
  `fsj_employer`, interview time and link, outcome in `fsj_feedback`, contract
  signature, payments verified in `fsj_pre_visa_payment_on`, visa refusal
  reason, joining and departure days, ticks in `fsj_done`) and seven
  `au_pair_` columns for what only this guide asks (consent, platform, pocket
  money, weekly hours, duration, appointment time and place). Every change goes
  through `updateTracked`, so the History tab has it.
- **Moves.** The same shape of action (check who may record the step, check the
  status move would be accepted before writing, write, keep the moment, move
  through `changeStatus`, tell the next team), the same role groups, the same
  hand-over to the documentation desk (`handedOverAt`, the ownership ledger),
  the Copy email button, and the portal card, now drawn by
  `src/components/step-journey.tsx` for both processes.

## Statuses

| Step | Team | Statuses |
|---|---|---|
| 1 Enquiry and initial counselling | Counsellor / branch | ASSESSMENT (where a new application starts) |
| 2 Registration and agreement | Counsellor / branch | REGISTRATION |
| 3 Document collection and handover | Counsellor / branch | DOCUMENT_COLLECTION |
| 4 Mentor assignment | Documentation | MENTOR_ASSIGNMENT |
| 5 Interview preparation | Student mentor | INTERVIEW_PREPARATION |
| 6 Profile submission and placement handover | Student mentor | PROFILE_SUBMITTED, HOST_FAMILY_FOUND |
| 7 Host family interview | Placement team | FAMILY_INTERVIEW |
| 8 Host family contract | Placement team | OFFER_RECEIVED, CONTRACT_SIGNED |
| 9 Pre-visa documentation | Visa team | PRE_VISA_DOCUMENTS |
| 10 Visa appointment booking and submission | Visa team | VISA_APPOINTMENT |
| 11 Visa processing and follow-up | Visa team | VISA_PROCESSING |
| 12 Visa approval and confirmation | Visa team | VISA_RECEIVED |
| 13 Pre-departure preparation | Travel desk | PRE_DEPARTURE |
| 14 Departure to Germany | Travel desk | JOINED |
| 15 Arrival and post-arrival follow-up | Travel desk | HAPPY_CALL |

The common statuses (pending from partner, on hold for the intake, deferred,
closed, visa rejected, withdrawn) follow, as for every pathway. Codes the
dashboards count (VISA_RECEIVED, PRE_DEPARTURE, JOINED, HAPPY_CALL) are reused.
Malayalam is given only where the same student words already have it ("Contract
signed", "Visa approved"); the rest shows the English.

## The tab and the decisions

The student's Au pair tab places the file on the 15 steps in their five stages,
names the mentor, shows the form for the step in hand to the team that owns it,
and lists every recorded moment. All forms post to `auPairStepAction`.

- **Counselling (step 1).** The guide's counselling points are ticked; the
  candidate's decision to proceed moves the file to registration once all are.
- **Registration (step 2).** The registration fee (or one-time fee), marked by
  someone with the Collect fees right as on the Fees tab, the day the
  consultancy agreement and declaration were signed, and the candidate form.
- **Documents and the hand-over (step 3).** The guide's list is the Au pair
  document requirements; the hand-over to the Documentation Department waits on
  the required ones and on the Medcity ID, email, German level, counsellor,
  registration fee and agreement, named one by one.
- **Mentor (step 4).** The documentation department picks a documentation
  officer. The mentor goes on the file (and can open it), the counsellor and
  branch head are told who, with the mentor's phone and email, to tell the
  candidate, and the file moves to interview preparation.
- **Preparation and profile (steps 5 and 6).** Each mock interview is recorded
  with its readiness and feedback. The profile is submitted only after a mock
  interview with the candidate ready and with the day of the candidate's
  consent. An interested host family is recorded with its platform (AuPair.com,
  Au-pair Vermittlung, or another, named); the hand-over to the placement team
  waits on the family's number being shared with the candidate.
- **Interview (step 7).** Each interview round is kept. Selected goes to the
  contract; not selected (with the family's feedback) goes back to interview
  preparation and the placement continues; that family is not offered again.
- **Contract (step 8).** Pocket money (euros a month), weekly hours and
  duration (months) as verified, then the candidate's signature, which needs
  the terms recorded and explained. Then the hand-over to the Visa Team.
- **Payment verification and the gate (steps 9 and 10).** Someone with the
  Collect fees right marks the payments verified; this is refused while the
  student has an issued, part-paid or written-off fee invoice, unless the head
  office (an admin) gives a reason, which is audited. The visa appointment is
  booked only with the payments verified, the signed contract and the required
  pre-visa documents in. The same gate holds every status move onto the
  appointment or a later step from before it, from the status picker and the
  imports too; an admin may override it there with a reason
  (`au_pair.visa_gate_override` in the audit log).
- **Visa (steps 10 to 12).** The appointment's date, time and location, the
  submission (with biometrics ticked), follow-ups and requests for more
  documents, and the decision: approved, or refused with its reason and what
  happens next: apply again while the family still wants the candidate, back to
  interview preparation for another family (the mentor, consent and payments
  are kept, the withdrawn family's interview, contract and visa round are
  cleared but stay in the history), or closed as visa rejected. On approval the
  visa team ticks the passport, the visa details and telling the family,
  confirms the joining date and hands over to the Travel Desk.
- **Travel desk (steps 13 to 15).** The guide's checklists, the departure day,
  and the follow-up, which starts with the happy call (with a note for the
  testimonial and references).

## Emails

The portal sends no email. At registration the counsellor and branch head get a
notice that the email to the Documentation Team is theirs to send, with the To
address (aupair@miak.in, from the Contacts list area "Au pair (Germany)") and
the branch head in copy. Step 2 on the tab has the text to copy. The
documentation team hears from the portal at the hand-over (step 3), the first
moment it can open the file, since notices reach only people who can open the
student; until then the email and the WhatsApp message are how it knows.
The guide's WhatsApp messages stay with people.

## The tracker and the portal

`/au-pair` lists every Au pair student the person may see, with the step, the
team, days at the step, mentor, host family and visa, filterable by step, team,
branch and days. The Placement and FSJ / BFD trackers link to it. On the student
portal the Au pair card shows the step in plain words, what comes next and who
to ring.

## Reaching production

Run migration `0090_au_pair_process`, then `deploy/au-pair-pathway.sql`
(generated by `scripts/au-pair-sql.ts`). Safe to run twice, and on a database
that loaded the provisional list: it inserts the new statuses, moves files off
the provisional codes the guide drops (AGENCY_PROFILE and FAMILY_MATCHING to
PROFILE_SUBMITTED, VISA_FILED to VISA_PROCESSING, the provisional "Arrived"
JOINED to HAPPY_CALL) with a line in each one's status history, brings the
chain to the guide's wording and order, retires the dropped codes (deactivated,
never deleted), adds the document types, requirements and contact where
missing, and prints what it moved and what is there.

## Still for people, and open points

- The emails and WhatsApp messages themselves, and the "concerned email IDs"
  the guide copies: the internal procedure names them, not the guide.
- Fee amounts and fee plan steps: the guide gives none, so only the
  registration fee day and the payment verification are recorded.
- The biometric photo document type reads "35 x 40 mm" (from Ausbildung); the
  Au pair requirement's guidance says 35 x 45 mm as the guide does.
- "Any additional documents required by the German authorities" is asked for
  as Other on the Documentation tab.
- The employer compensation terms and refund policy are explained at
  counselling; the portal records that they were, not their content.
- Malayalam for the new statuses, document types and the portal card.
