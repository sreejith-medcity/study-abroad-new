/**
 * A file nobody at the desk is carrying yet.
 *
 * Nothing in the portal assigns a student to a documentation officer. What
 * there is, is the moment a branch hands an application to the desk, and the
 * officer on the application, which the team leader sets. A file the branch
 * has handed over with no officer on it is therefore a file that has arrived
 * and that nobody has been given: the team leader's to hand out.
 *
 * Two kinds of handed-over file are not waiting for an officer. One the desk
 * has sent back to the branch is the branch's again until it comes back, and
 * a closed case is not waiting for anybody. Both stay out, so the count on the
 * menu is the number of files somebody actually has to give out.
 *
 * The same rule is written as SQL in server/scope.ts (`unassignedFile`); the
 * two must say the same thing, and the tests hold this one to it.
 */
export type FileLike = {
  handedOverAt: Date | string | null;
  officerId: string | null;
  deskStage: string;
  statusGroup: string;
};

export function isUnassignedFile(f: FileLike): boolean {
  if (!f.handedOverAt) return false;
  if (f.officerId) return false;
  if (f.deskStage === "RETURNED") return false;
  return f.statusGroup !== "CLOSED";
}

/** The words on a tab or a tile, so the screens never disagree about how to say it. */
export function unassignedText(n: number): string {
  if (n === 0) return "Every handed-over file has an officer";
  return `${n} ${n === 1 ? "file" : "files"} with no officer`;
}

/** The value the applications list and the work queue take for this view. */
export const UNASSIGNED = "unassigned";
