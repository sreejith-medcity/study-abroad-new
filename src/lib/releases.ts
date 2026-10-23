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
    version: "1.0.0",
    date: "2026-10-23",
    changes: [
      "Releases are numbered from here on, and the portal shows the version it is running at the foot of the menu and on this page.",
      "The countries, universities and courses from the MIOC app can be brought in from a phpMyAdmin export, on the Programs screen. New courses arrive as drafts; courses the team researched by hand are left alone.",
      "Every change to a course or a university keeps the old value, with who changed it and when, and an admin can put it back.",
      "Replacing a student's document keeps the earlier file as an earlier version, removing one keeps the file so the desk can put it back, and an earlier version can be made current again.",
      "A notice about a student only goes to people who can open that student, and an old notice about a file that is no longer open to you says so instead of showing 'page not found'.",
      "Search stays quick with a catalogue of a hundred thousand courses.",
      "The daily journal opens as a popup from 5 PM and can be minimised.",
    ],
  },
];
