import { HQ_ROLES, PARTNER_ROLES, ROLE_LABEL, STUDENT_WORK_ROLES } from "./permissions";

/**
 * The rules behind editing a person and moving them to another branch, kept
 * apart from the database so they can be read, and tested, on their own.
 */

export type OrgType = "HQ" | "BRANCH" | "SUB_AGENT";

/** The address as it is stored and compared: trimmed and in lower case. */
export function normalizeEmail(raw: string | null | undefined) {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Why an address cannot be a sign-in email, or null when it can. One name,
 * one @, one domain with a dot in it, nothing a browser would not accept.
 * The check is deliberately plain: an address the person cannot receive mail
 * at is caught by them not receiving the password, not by a longer regex.
 */
export function emailProblem(raw: string | null | undefined): string | null {
  const email = normalizeEmail(raw);
  if (!email) return "Enter an email address.";
  if (email.length > 254) return "That email address is too long.";
  if (/\s/.test(email)) return "An email address has no spaces in it.";
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return "Enter a valid email, like name@example.com.";
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || domain.startsWith("-") || domain.includes("..")) return "Enter a valid email, like name@example.com.";
  if (!/^[a-z0-9._%+'-]+$/.test(email.slice(0, at))) return "Enter a valid email, like name@example.com.";
  return null;
}

/**
 * Whether a role belongs in an organisation of this type. The same rule the
 * add-user screen applies: the head office has its own roles, a branch has the
 * branch head and the branch counsellor levels, and a sub-agent firm has the
 * owner and its own counsellor. A move that would break this is refused
 * rather than carried out with a role the new organisation has no use for.
 */
export function roleFitsOrg(role: string, type: OrgType): boolean {
  if (type === "HQ") return (HQ_ROLES as readonly string[]).includes(role);
  if (!(PARTNER_ROLES as readonly string[]).includes(role)) return false;
  if (type === "SUB_AGENT") return role === "PARTNER" || role === "SUB_AGENT_COUNSELLOR";
  return role !== "SUB_AGENT_COUNSELLOR";
}

const ORG_TYPE_NAME: Record<OrgType, string> = { HQ: "Medcity Overseas", BRANCH: "a Medcity branch", SUB_AGENT: "a sub-agent firm" };

/** The plain sentence given when a role does not fit. */
export function roleFitRefusal(role: string, type: OrgType): string {
  return `${ROLE_LABEL[role] ?? role} is not a role at ${ORG_TYPE_NAME[type]}. Change their role first, or pick another organisation.`;
}

export type MoveInput = {
  /** The person being moved. */
  person: { id: string; role: string; orgId: string };
  from: { id: string; type: OrgType };
  to: { id: string; type: OrgType; active: boolean };
  /** How many students are assigned to them at the old branch. */
  students: number;
  /** What happens to those students: handed to a colleague, or left with nobody. */
  choice: string;
  /** The colleague chosen, as the database describes them, or null when none was chosen. */
  colleague: { id: string; orgId: string; role: string; active: boolean } | null;
};

export type MovePlan = {
  /** Who the students go to, or null when they are left unassigned. */
  handTo: string | null;
  /** How many students change hands or lose their counsellor. */
  students: number;
};

/**
 * Works out what a move will do, or why it cannot be done. Pure: everything it
 * needs is passed in, so the one transaction that applies it has nothing left
 * to decide.
 */
export function planMove(input: MoveInput): { ok: true; plan: MovePlan } | { ok: false; error: string } {
  const { person, from, to, students, choice, colleague } = input;
  if (to.id === from.id || to.id === person.orgId) return { ok: false, error: "They are already at that organisation." };
  if (!to.active) return { ok: false, error: "That organisation is closed. Open it again before moving anybody into it." };
  if (!roleFitsOrg(person.role, to.type)) return { ok: false, error: roleFitRefusal(person.role, to.type) };
  if (students === 0) return { ok: true, plan: { handTo: null, students: 0 } };
  if (choice === "leave") return { ok: true, plan: { handTo: null, students } };
  if (choice !== "hand") return { ok: false, error: `Say what happens to the ${students === 1 ? "student" : `${students} students`} assigned to them: hand them to a colleague, or leave them unassigned.` };
  if (!colleague) return { ok: false, error: "Pick the colleague who takes their students." };
  if (colleague.id === person.id) return { ok: false, error: "The students cannot be handed to the person who is leaving." };
  if (colleague.orgId !== from.id) return { ok: false, error: "The colleague has to be at the branch the students belong to." };
  if (!colleague.active) return { ok: false, error: "That colleague is switched off. Pick somebody who can sign in." };
  if (!(STUDENT_WORK_ROLES as readonly string[]).includes(colleague.role)) return { ok: false, error: "That colleague cannot work student files. Pick somebody who can." };
  return { ok: true, plan: { handTo: colleague.id, students } };
}
