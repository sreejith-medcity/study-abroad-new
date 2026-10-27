/**
 * The choices on a student's "Assigned to" dropdown, and what each one means.
 *
 * The dropdown used to offer three things: nobody, somebody at the student's
 * own branch, and somebody at the head office. The head office also has to
 * send a student to a department (the Ausbildung team, the FSJ team) or to
 * another branch altogether, and the only ways to do either were two
 * separate panels on the student's file. So the same dropdown now carries a
 * group for every live team and every other open branch, for the head office
 * admins only.
 *
 * Each option's value says which of four things it is, so the server can
 * route it without trusting the label or the group it was shown in:
 *
 *   ""                    nobody
 *   "<userId>"            this person counsels the student (as before)
 *   "team:<teamId>"       the team carries the file, nobody named yet
 *   "team:<teamId>:<id>"  the team carries it and this member has it
 *   "move:<orgId>:<id>"   the student moves to that branch, this person counselling
 *
 * The plain id is kept for a counsellor so a form posted before the script
 * runs still means what it always meant. The server checks every part of
 * the value again before it does anything.
 */

export type AssignChoice =
  | { kind: "none" }
  | { kind: "person"; userId: string }
  | { kind: "team"; teamId: string; userId: string | null }
  | { kind: "move"; orgId: string; userId: string };

// An id as the database hands them out: no colons, nothing longer than a uuid.
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** What an option's value asks for, or null for one the dropdown never offers. */
export function parseAssignChoice(raw: string | null | undefined): AssignChoice | null {
  const value = String(raw ?? "").trim();
  if (!value) return { kind: "none" };
  const parts = value.split(":");
  if (parts.length === 1) return ID.test(value) ? { kind: "person", userId: value } : null;
  const [kind, a, b] = parts;
  if (kind === "team" && (parts.length === 2 || parts.length === 3) && ID.test(a)) {
    if (parts.length === 2) return { kind: "team", teamId: a, userId: null };
    return ID.test(b) ? { kind: "team", teamId: a, userId: b } : null;
  }
  if (kind === "move" && parts.length === 3 && ID.test(a) && ID.test(b)) return { kind: "move", orgId: a, userId: b };
  return null;
}

export const teamValue = (teamId: string, userId?: string | null) => (userId ? `team:${teamId}:${userId}` : `team:${teamId}`);
export const moveValue = (orgId: string, userId: string) => `move:${orgId}:${userId}`;

/** "Ausbildung team", without saying team twice for a team already named that way. */
export function teamLabel(name: string) {
  return /\bteam$/i.test(name.trim()) ? name.trim() : `${name.trim()} team`;
}

/** The sentence a move is confirmed with, before anything is moved. */
export function moveConfirmText(studentName: string, branchName: string) {
  return `This moves ${studentName} to ${branchName}. Their Medcity ID, documents and invoices stay as they are.`;
}

export type AssignPerson = { id: string; name: string; deskLabel: string | null; role?: string };
export type AssignOption = { value: string; label: string };
export type AssignGroup = { label: string; kind: "branch" | "head-office" | "team" | "move"; options: AssignOption[]; branchName?: string };

/** The teams and the other branches, read once for the whole page. */
export type WiderChoices = {
  teams: { id: string; name: string; members: AssignPerson[] }[];
  branches: { id: string; name: string; people: AssignPerson[] }[];
};

const nameOf = (p: AssignPerson) => p.deskLabel ?? p.name;

/**
 * The groups below "Unassigned" for one student's dropdown: their branch's
 * people, the head office's, then (for an admin, when given) one group per
 * team and one per other branch, labelled as the move it is. A branch with nobody to take the student is
 * left out, since there is nobody there to pick; a team with no members still
 * shows, because the team on its own can be given the file.
 */
export function assignGroups(input: {
  orgId: string;
  orgName: string;
  branch: AssignPerson[];
  headOffice: AssignPerson[];
  roleLabel?: (role: string) => string;
  wider?: WiderChoices | null;
}): AssignGroup[] {
  const groups: AssignGroup[] = [];
  if (input.branch.length) groups.push({ label: input.orgName, kind: "branch", options: input.branch.map((p) => ({ value: p.id, label: nameOf(p) })) });
  if (input.headOffice.length) {
    groups.push({
      label: "Head office",
      kind: "head-office",
      options: input.headOffice.map((p) => ({ value: p.id, label: p.role && input.roleLabel ? `${nameOf(p)} (${input.roleLabel(p.role)})` : nameOf(p) })),
    });
  }
  for (const t of input.wider?.teams ?? []) {
    groups.push({
      label: teamLabel(t.name),
      kind: "team",
      options: [{ value: teamValue(t.id), label: "Whole team, nobody named yet" }, ...t.members.map((m) => ({ value: teamValue(t.id, m.id), label: nameOf(m) }))],
    });
  }
  for (const b of input.wider?.branches ?? []) {
    if (b.id === input.orgId || !b.people.length) continue;
    groups.push({ label: `Move to ${b.name}`, branchName: b.name, kind: "move", options: b.people.map((p) => ({ value: moveValue(b.id, p.id), label: nameOf(p) })) });
  }
  return groups;
}
