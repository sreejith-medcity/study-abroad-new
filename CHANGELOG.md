# Changelog

Releases of the Medcity Overseas portal, newest first. Each release bumps the
version in package.json and adds an entry here and in src/lib/releases.ts (the
What's new page reads that one). After applying a release, tag it with the
version so it can be found and rolled back to.

## 1.0.0 (23 October 2026)

The first numbered release. Everything built before it is in the git history.

- Releases are numbered from here on, and the portal shows the version it is running at the foot of the menu and on the What's new page.
- The countries, universities and courses from the MIOC app can be brought in from a phpMyAdmin export, on the Programs screen. New courses arrive as drafts; courses the team researched by hand are left alone.
- Every change to a course or a university keeps the old value, with who changed it and when, and an admin can put it back.
- Replacing a student's document keeps the earlier file as an earlier version, removing one keeps the file so the desk can put it back, and an earlier version can be made current again.
- A notice about a student only goes to people who can open that student, and an old notice about a file that is no longer open to you says so instead of showing "page not found".
- Search stays quick with a catalogue of a hundred thousand courses.
- The daily journal opens as a popup from 5 PM and can be minimised.
