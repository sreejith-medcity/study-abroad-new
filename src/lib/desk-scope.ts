/**
 * How much of the documentation desk one person works: the whole desk, or
 * their own files.
 *
 * Medcity chose "own only" for the documentation officers. An officer sees the
 * files and documents they have been given or have taken on, and nothing else:
 * not every file a branch has handed over, not the pool of documents nobody
 * has claimed, and not the counts of the whole desk. The team leader hands
 * everything else out from the Unassigned tab.
 *
 * The line is the capability "See the whole desk, not only their own files"
 * (RUN_DOCUMENTATION_DESK). Whoever has it works the desk as before; a
 * documentation officer without it works only what is theirs. Pure, so the
 * rule can be tested without a database; server/scope.ts asks it of the
 * matrix Medcity has set.
 */

import { roleCan, type Override } from "./capabilities";
import { DOCUMENTATION_ROLES } from "./permissions";

export type DeskReach = "WHOLE_DESK" | "OWN_FILES";

const onTheDesk = (role: string) => (DOCUMENTATION_ROLES as readonly string[]).includes(role);

/** The whole desk, or only their own files. */
export function deskReach(role: string, overrides: Override[] = []): DeskReach {
  return roleCan(role, "RUN_DOCUMENTATION_DESK", overrides) ? "WHOLE_DESK" : "OWN_FILES";
}

/**
 * Whether a file opens to this person because the branch has handed it to the
 * desk. Only somebody on the documentation desk who runs the whole of it: an
 * officer working their own files is given a file by name, not by its arrival.
 */
export function opensHandedOverFiles(role: string, overrides: Override[] = []): boolean {
  return onTheDesk(role) && deskReach(role, overrides) === "WHOLE_DESK";
}

/**
 * A documentation officer who works only their own files. The screens that
 * would otherwise show the whole desk (the queue, the vendor desk, the counts
 * on the menu and the dashboard) narrow to that person's own students.
 */
export function worksOwnFilesOnly(role: string, overrides: Override[] = []): boolean {
  return onTheDesk(role) && deskReach(role, overrides) === "OWN_FILES";
}

/**
 * Who is told that a file has arrived at the desk: whoever runs the desk or
 * hands its files out. An officer hears about a file once it is theirs, from
 * the notice that gives it to them, not from every hand-over on the portal.
 */
export function hearsOfHandovers(role: string, overrides: Override[] = []): boolean {
  return roleCan(role, "RUN_DOCUMENTATION_DESK", overrides) || roleCan(role, "SEE_UNASSIGNED_FILES", overrides);
}

/**
 * Whether this person may claim a document from the documentation queue.
 *
 * Somebody running the whole desk may claim anything waiting. An officer
 * working their own files may claim a document only on a file that is
 * already theirs; the pool, the documents on everybody else's files, is the
 * team leader's to hand out. A document somebody else is holding stays theirs
 * while the claim lasts, for everybody.
 */
export function mayClaimDocument(args: { reach: DeskReach; studentIsTheirs: boolean; heldByOther: boolean }): boolean {
  if (args.heldByOther) return false;
  return args.reach === "WHOLE_DESK" || args.studentIsTheirs;
}

/** What the queue's heading says about whose documents are on it. */
export function queueReachText(reach: DeskReach): string {
  return reach === "WHOLE_DESK"
    ? "One row per student, oldest first; open a row for the documents. A document is claimed while somebody checks it so two people never check the same one."
    : "Only your own files: the applications you are the officer on, the documents you have claimed or checked, and the students you have been put on. The team leader hands out everything else.";
}
