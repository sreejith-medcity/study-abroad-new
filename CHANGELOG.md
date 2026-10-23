# Changelog

Releases of the Medcity Overseas portal, newest first. Each release bumps the
version in package.json and adds an entry here and in src/lib/releases.ts (the
What's new page reads that one). After applying a release, tag it with the
version so it can be found and rolled back to.

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
