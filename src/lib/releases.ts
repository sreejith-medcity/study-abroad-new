/**
 * The portal's releases, newest first: the number, the day it was cut, and
 * what changed, in the words the team reads on the What's new page.
 *
 * Every release bumps "version" in package.json and adds an entry here and in
 * CHANGELOG.md, in the same commit; tests/releases.test.ts holds the three
 * together. The number follows the usual rule: the last figure for a fix, the
 * middle one for something new, the first for a change that needs the team to
 * work differently.
 */
export type Release = { version: string; date: string; changes: string[] };

export const RELEASES: Release[] = [
  {
    version: "1.5.1",
    date: "2026-10-26",
    changes: [
      "A counsellor sees only their own students everywhere: Students by stage, the search, the deadlines page and the placement tracker now apply the same rule as the students list, so a counsellor's board no longer shows the whole branch.",
      "A counsellor's dashboard says how many of the branch's students are not given to anyone, which is why their list is longer than their own students.",
      "The Documentation badge counts students with a document waiting, not documents, and the queue says both.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-10-26",
    changes: [
      "The draft review points out the drafts worth a look before publishing: a duplicate of another course at the university, a fee far from others at that level in that country, a fee kept in words, no intakes, an odd course length, an odd English score. A Show filter keeps the clean ones apart, and Publish all clean drafts publishes only those.",
      "Two staff guides in the learning library, each with a short course: The day end report, and The Ausbildung process in the portal. A How this works link opens them from the report and the Ausbildung screens.",
      "System moved to the Set up group of the menu.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-26",
    changes: [
      "A System screen under Reports tells the owner the portal is well: the release running, the database and its counts, where documents are kept and whether the folder is writable, every scheduled job's last run with a Run now for the owner, and the health check, with a Copy report button for asking for help. No password is ever on it.",
      "The consolidated day end report downloads as an Excel workbook (cover, people, figures) and prints cleanly.",
      "An Ausbildung student sees their own journey on the portal home: the six desks, the step they are at and what comes next in plain words, their counsellor and mentor, their German levels, and which payment milestone is next.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-26",
    changes: [
      "An Ausbildung file reaches the documentation desk the way the written process says: the branch hands it over from the Ausbildung tab once the registration papers are in, or it is handed over by itself when its status reaches step 4, and the desk can open it from that moment. The desk names a documentation mentor on the file; the counsellor and branch head are told who it is and how to reach them, the status moves to Mentor assigned, and the tracker shows the mentor.",
      "The day end report pre-fills connected calls from the calls logged as reached and leads received from the enquiries entered that day that the person holds, both still editable, with a line under each box saying where the number came from.",
      "Each branch head is told how their branch's day end went: one notice a day with the counts and the day's figures, and a flagged report reaches them at once with the note.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-26",
    changes: [
      "The day end figures have a month view: each counsellor's leads, calls, connected calls, follow-ups and registrations added up over the month, with days answered and missed, branch and overall totals, a day-by-day list per counsellor, and a download as Excel. A branch head sees their own branch; the report roles see every branch.",
      "The dashboards show the day's figures: a counsellor's own for today and the month so far, a branch head's per counsellor, and leadership's per branch.",
      "An Ausbildung file that sits at a step longer than the written process allows is followed up every morning: a task for the desk that owns the step and a notice to the people who can open the file, once per stay at that step. The placement tracker filters to files over their turnaround, and the documentation desk's dashboard counts them.",
      "A course with no fee, score or length on record is never counted, ranked, passed or labelled as if it had one: the course finder counts only recorded fees inside a budget, a missing course length is a warning rather than a pass on the passport check, and \"No English test\" now reads \"No English test recorded\".",
      "The dashboard's week and today are India's wherever the server runs.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-25",
    changes: [
      "The daily journal is now the day end report. Counsellors and branch heads give the day's figures with it: leads received, calls made, connected calls, follow-ups done and registrations done. Calls, follow-ups and registrations are pre-filled from the portal; every box is required before the report is verified. The consolidated report lists the figures per counsellor with totals per branch.",
      "The Ausbildung desk can record every step of Medcity's written process: eleven new statuses (mentor assigned, document preparation, language assessment, mock interview passed, profile submitted, employer shortlisted, pre-visa documents, visa processing, pre-departure, happy call), the guide's documents as stage requirements, the service-charge milestones on the file and the tracker, the desk and turnaround for each step, and the hand-over addresses on Contacts.",
      "A person put on a student's file can always open it: the head office is refused somebody from another branch.",
      "The move to the VPS: the deploy kit carries the migration history, checks row counts on both sides, backs up nightly, and the portal reports its health.",
      "Publishing everything that matches stops only when nothing is left, and the CSV import says plainly that a live course with no work-rights evidence goes back to draft.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-10-24",
    changes: [
      "A course goes live only when it is ready, whichever way it is published: it needs an intake, and a work-rights answer needs its evidence. Publishing everything that matches the filters now says how many went live and how many stayed drafts, and why; publishing one course says why it cannot.",
      "A course imported from a CSV as live but with a work-rights answer and no evidence comes in as a draft, and the import says so.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-23",
    changes: [
      "Releases are numbered from here on, and the portal shows the version it is running at the foot of the menu and on this page.",
      "The countries, universities and courses from the MIOC app can be brought in from a phpMyAdmin export, on the Programs screen. New courses arrive as drafts; courses the team researched by hand are left alone.",
      "University profiles and destination guides come over from the MIOC app too: an About section on each university, and a guide per country (overview, capital, languages, climate, accommodation, common questions) beside programs and universities, editable on Destinations.",
      "Admins can edit a university: name, city, website, public or private, rankings, about text and facts.",
      "Every change to a course or a university keeps the old value, with who changed it and when, and an admin can put it back. A value changed again since is never overwritten by a restore.",
      "Programs can be filtered to the MIOC app's courses, and a draft review screen takes the desk through them university by university: what each has recorded, publish or archive the ones checked, and why any could not go live.",
      "Replacing a student's document keeps the earlier file as an earlier version, removing one keeps the file so the desk can put it back, and an earlier version can be made current again. A student cannot replace a document the team has already accepted.",
      "A notice about a student only goes to people who can open that student, and an old notice about a file that is no longer open to you says so instead of showing 'page not found'.",
      "Search stays quick with a catalogue of a hundred thousand courses.",
      "Student files, and reading them with the assistant, open only for staff who can open that student.",
      "The daily journal opens as a popup from 5 PM and can be minimised.",
    ],
  },
];
