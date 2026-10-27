# Changelog

Releases of the Medcity Overseas portal, newest first. Each release bumps the
version in package.json and adds an entry here and in src/lib/releases.ts (the
What's new page reads that one). After applying a release, tag it with the
version so it can be found and rolled back to.

## 1.8.1 (27 October 2026)

- A person can be moved to another organisation with a new role in one step: from the head office to a branch as its branch head, from a branch to the head office, or between branches and sub-agent firms. The move form offers only the roles that fit the organisation chosen, warns when the branch already has a branch head, and keeps every earlier safeguard: a branch is never left without a head, and its students and open tasks are handed to a colleague or left for the branch head. Someone leaving the head office comes off its teams, service ownership and the officer field on open files. Moving anybody into or out of the head office, or changing their role, needs the right to manage users; only a super admin moves a super admin, and the last one cannot be moved out.
- Adding a user whose email is already in use now says who has it: their name, role, organisation and whether they are switched off, with a link to move them when you may. A branch head is told only that the email belongs to someone at another organisation, and to ask the head office to move them.
- Adding a Medcity Overseas desk counsellor, application team leader or finance user no longer fails with an error.

Nothing to run on the VPS beyond the new build: no migration and no SQL.

## 1.8.0 (27 October 2026)

- FSJ and BFD are pathways of their own and follow the written FSJ & BFD process: 18 steps across the branch, documentation, interviews, the visa team and the travel desk, with the language assessment and re-assessment, the fee check before the application starts, interviews with employer feedback (including another employer when not selected or when an employer withdraws after a visa refusal), offer and contract, VFS slot, visa outcome, pre-departure and the follow-up after arrival. Each student has an FSJ / BFD tab, the FSJ / BFD tracker lists every file by step and department, and the student sees their step on their portal. The portal does not send email: each email in the guide becomes a notice to whoever sends it, with the addresses and the text to copy.
- Calling mode under Calls opens a counsellor's own enquiries and students that need a call, one at a time: not contacted yet, then late follow-ups, then today's, with tap to call, WhatsApp and seven outcomes that set the next call or close the enquiry. Branch heads see their team's queue.
- Enquiries keep a call history with how and with what result, every next follow-up is a task on My day, and the day end report counts calls to enquiries too.
- Reports has a Counsellor leaderboard: calls made, connected, follow-ups on time and late, and enquiries converted for any period, from what was recorded.
- Student fees: fee plans from Medcity's fee sheets with instalments due on a date or a step of the student's process, invoices with GST when the branch's GSTIN is recorded, receipts, printable invoices, receipts and credit notes, payment links through Razorpay, waiving an instalment, refunds approved by someone other than the person asking, receivables ageing and a day book. Students see their invoices and receipts on their portal.

On the VPS this release runs `docker compose --profile tools run --rm migrate` (migrations 0082 to 0086), then loads `deploy/fsj-bfd-process.sql`, before the new build. Branches need their GSTIN recorded before fee invoices carry GST, and an FSJ or BFD programme added under Programs before an FSJ or BFD application can start.

## 1.7.0 (27 October 2026)

- New enquiries without an owner are given out by routing rules: by source, pathway and branch, each naming a person or sharing enquiries in turn among the branch's active counsellors, fewest open enquiries first. The head office sets rules for any branch and a branch head for their own, under Settings, Enquiries. With no matching rule an enquiry stays with the branch to hand out, as before.
- A number that enquires again no longer makes a duplicate: an open enquiry gets a note saying it came again and from where, and a lost one is reopened with a follow-up for the next day.
- Each enquiry shows possible duplicates at any branch by phone or email, and the head office or the branch head can merge them: the history moves to the enquiry kept and the other is marked Merged.
- Closing an enquiry as lost asks for a reason from a list kept in Settings, and Reports has a Lost reasons report by reason, source and branch with a CSV.
- Every change to a student, an enquiry, an application or a staff account is kept: who changed which field, from what, to what and when. History tabs compare any two versions and put a single field back where that is safe, and Change history lists every change a person may read.
- Who owns each student and enquiry over time is kept on an ownership ledger that only ever grows, each entry sealed with the one before it; the Ownership ledger screen checks the whole chain and names any entry that has been changed.

On the VPS this release runs `docker compose --profile tools run --rm migrate` (migrations 0078 to 0081) before the new build; build migration 0081's indexes off-peak.

## 1.6.0 (26 October 2026)

- A counsellor's students are the ones given to them and the ones they registered themselves, and nobody else's. A student a colleague registered and nobody has been given to no longer appears in every counsellor's list; the branch head hands them out.
- A counsellor's dashboard counts exactly what their students list shows: My students, applications, offers, visas, the board by stage, documents still to come and placements. Every figure opens a list holding the same number, and a tile now says how many students they registered that are not yet given to a counsellor.
- The documentation queue shows one row per student, sixty to a page, with how long their oldest document has waited, how many are waiting and who holds them. A row opens to show the documents with the same Check, claim and Reassign controls. The wait counts from when the file was sent in, so claiming a document no longer resets it.
- People can be edited and moved: the head office corrects a person's name, sign-in email, job title and department, a branch head does the same for their own counsellors, and a person moves to another branch with their students and open tasks handed to a colleague or the branch head. Departments (Ausbildung, NCLEX and the rest) are kept in Settings and filter the people lists.
- Registering a student from an enquiry keeps them with the counsellor the enquiry was with.
- Everywhere a student is picked by name (search, finder, events, program options, the practice interview, commission statements, pack downloads), a counsellor is offered only the students they may open.

The live database needs supabase-0079-user-department.sql (or, on the VPS, `docker compose --profile tools run --rm migrate`) before this release runs.

## 1.5.1 (26 October 2026)

- A counsellor sees only their own students everywhere: Students by stage, the search, the deadlines page and the placement tracker now apply the same rule as the students list, so a counsellor's board no longer shows the whole branch.
- A counsellor's dashboard says how many of the branch's students are not given to anyone, which is why their list is longer than their own students.
- The Documentation badge counts students with a document waiting, not documents, and the queue says both.

## 1.5.0 (26 October 2026)

- The draft review points out the drafts worth a look before publishing: a duplicate of another course at the university, a fee far from others at that level in that country, a fee kept in words, no intakes, an odd course length, an odd English score. A Show filter keeps the clean ones apart, and Publish all clean drafts publishes only those.
- Two staff guides in the learning library, each with a short course: The day end report, and The Ausbildung process in the portal. A How this works link opens them from the report and the Ausbildung screens.
- System moved to the Set up group of the menu.

## 1.4.0 (26 October 2026)

- A System screen under Reports tells the owner the portal is well: the release running, the database and its counts, where documents are kept and whether the folder is writable, every scheduled job's last run with a Run now for the owner, and the health check, with a Copy report button. No password is ever on it.
- The consolidated day end report downloads as an Excel workbook (cover, people, figures) and prints cleanly.
- An Ausbildung student sees their own journey on the portal home: the six desks, the step they are at and what comes next in plain words, their counsellor and mentor, their German levels, and which payment milestone is next.

## 1.3.0 (26 October 2026)

- An Ausbildung file reaches the documentation desk the way the written process says: the branch hands it over from the Ausbildung tab once the registration papers are in, or it is handed over by itself when its status reaches step 4, and the desk can open it from that moment. The desk names a documentation mentor on the file; the counsellor and branch head are told who it is, the status moves to Mentor assigned, and the tracker shows the mentor.
- The day end report pre-fills connected calls from the calls logged as reached and leads received from the enquiries entered that day that the person holds, both still editable, with a line under each box saying where the number came from.
- Each branch head is told how their branch's day end went: one notice a day with the counts and the day's figures, and a flagged report reaches them at once with the note.

## 1.2.0 (26 October 2026)

- The day end figures have a month view: each counsellor's leads, calls, connected calls, follow-ups and registrations added up over the month, with days answered and missed, branch and overall totals, a day-by-day list per counsellor, and a download as Excel. A branch head sees their own branch; the report roles see every branch.
- The dashboards show the day's figures: a counsellor's own for today and the month so far, a branch head's per counsellor, and leadership's per branch.
- An Ausbildung file that sits at a step longer than the written process allows is followed up every morning: a task for the desk that owns the step and a notice to the people who can open the file, once per stay at that step. The placement tracker filters to files over their turnaround, and the documentation desk's dashboard counts them.
- A course with no fee, score or length on record is never counted, ranked, passed or labelled as if it had one.
- The dashboard's week and today are India's wherever the server runs.

## 1.1.0 (25 October 2026)

- The daily journal is now the day end report. Counsellors and branch heads give the day's figures with it: leads received, calls made, connected calls, follow-ups done and registrations done. Calls, follow-ups and registrations are pre-filled from the portal; every box is required before the report is verified. The consolidated report lists the figures per counsellor with totals per branch.
- The Ausbildung desk can record every step of Medcity's written process: eleven new statuses, the guide's documents as stage requirements, the service-charge milestones on the file and the tracker, the desk and turnaround for each step, and the hand-over addresses on Contacts.
- A person put on a student's file can always open it: the head office is refused somebody from another branch.
- The move to the VPS: the deploy kit carries the migration history, checks row counts on both sides, backs up nightly, and the portal reports its health.
- Publishing everything that matches stops only when nothing is left, and the CSV import says plainly that a live course with no work-rights evidence goes back to draft.

## 1.0.1 (24 October 2026)

- A course goes live only when it is ready, whichever way it is published: it needs an intake, and a work-rights answer needs its evidence. Publishing everything that matches the filters now says how many went live and how many stayed drafts, and why; publishing one course says why it cannot.
- A course imported from a CSV as live but with a work-rights answer and no evidence comes in as a draft, and the import says so.

## 1.0.0 (23 October 2026)

The first numbered release. Everything built before it is in the git history.

- Releases are numbered from here on, and the portal shows the version it is running at the foot of the menu and on the What's new page.
- The countries, universities and courses from the MIOC app can be brought in from a phpMyAdmin export, on the Programs screen. New courses arrive as drafts; courses the team researched by hand are left alone.
- University profiles and destination guides come over from the MIOC app too: an About section on each university, and a guide per country (overview, capital, languages, climate, accommodation, common questions) beside programs and universities, editable on Destinations.
- Admins can edit a university: name, city, website, public or private, rankings, about text and facts.
- Every change to a course or a university keeps the old value, with who changed it and when, and an admin can put it back. A value changed again since is never overwritten by a restore.
- Programs can be filtered to the MIOC app's courses, and a draft review screen takes the desk through them university by university: what each has recorded, publish or archive the ones checked, and why any could not go live.
- Replacing a student's document keeps the earlier file as an earlier version, removing one keeps the file so the desk can put it back, and an earlier version can be made current again. A student cannot replace a document the team has already accepted.
- A notice about a student only goes to people who can open that student, and an old notice about a file that is no longer open to you says so instead of showing "page not found".
- Search stays quick with a catalogue of a hundred thousand courses.
- Student files, and reading them with the assistant, open only for staff who can open that student.
- The daily journal opens as a popup from 5 PM and can be minimised.
