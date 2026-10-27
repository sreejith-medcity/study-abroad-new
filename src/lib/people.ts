import { ADMIN_ROLES, HQ_ROLES, PARTNER_ROLES, ROLE_LABEL, STUDENT_WORK_ROLES, isFamilyRole } from "./permissions";

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

/**
 * The plain sentence given when the role picked for a move does not fit where
 * they are going. Unlike the one above, the role is chosen on the same screen,
 * so it asks for another role rather than sending the desk away to change it.
 */
export function moveRoleRefusal(role: string, type: OrgType): string {
  return `${ROLE_LABEL[role] ?? role} is not a role at ${ORG_TYPE_NAME[type]}. Pick one of the roles that fit it.`;
}

/**
 * The roles a person could have at an organisation of this type, in the order
 * the screens list them. The move form offers these and nothing else.
 */
export function rolesFor(type: OrgType, options: readonly string[]): string[] {
  return options.filter((r) => roleFitsOrg(r, type));
}

/**
 * The role a move starts from on screen: the one they have, when it fits
 * where they are going, otherwise the first that does.
 */
export function defaultMoveRole(current: string, type: OrgType, options: readonly string[]): string {
  const fits = rolesFor(type, options);
  return fits.includes(current) ? current : (fits[0] ?? current);
}

export type MoveInput = {
  /** The person being moved. */
  person: { id: string; role: string; orgId: string; active: boolean };
  from: { id: string; type: OrgType; name: string };
  to: { id: string; type: OrgType; active: boolean; name: string };
  /**
   * The role they have after the move, when it changes in the same step.
   * Left out, they keep the one they have.
   */
  role?: string;
  /**
   * How many students are assigned to them where they are leaving: at the old
   * branch, or, for somebody leaving the head office, anywhere.
   */
  students: number;
  /**
   * Open tasks on their name, read only for somebody leaving the head office.
   * A branch has its head to fall back on for tasks; the head office has
   * nobody in that place, so there the tasks are part of the same hand-over
   * choice as the students.
   */
  tasks?: number;
  /** What happens to those students: handed to a colleague, or left with nobody. */
  choice: string;
  /** The colleague chosen, as the database describes them, or null when none was chosen. */
  colleague: { id: string; orgId: string; role: string; active: boolean } | null;
  /**
   * Active branch heads, not counting the person moving: how many the old
   * organisation keeps, and how many the new one already has. Read when the
   * person is a branch head now, or is becoming one.
   */
  heads: { othersAtFrom: number; atTarget: number };
};

export type MovePlan = {
  /** Who the students go to, or null when they are left unassigned. */
  handTo: string | null;
  /** How many students change hands or lose their counsellor. */
  students: number;
  /** The role they have after the move. */
  role: string;
  /** Whether that is a different role from the one they had. */
  roleChanged: boolean;
  /**
   * Whether they are leaving the head office, so the desk-only things on
   * their name (teams, request types, officer on open applications, their
   * part on files at other branches) are taken off them.
   */
  leavesHeadOffice: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Works out what a move will do, or why it cannot be done. Pure: everything it
 * needs is passed in, so the one transaction that applies it has nothing left
 * to decide.
 */
export function planMove(input: MoveInput): { ok: true; plan: MovePlan } | { ok: false; error: string } {
  const { person, from, to, students, choice, colleague, heads } = input;
  const role = input.role || person.role;
  const roleChanged = role !== person.role;
  const leavesHeadOffice = from.type === "HQ";
  if (to.id === from.id || to.id === person.orgId) return { ok: false, error: "They are already at that organisation." };
  if (!to.active) return { ok: false, error: "That organisation is closed. Open it again before moving anybody into it." };
  if (isFamilyRole(role)) return { ok: false, error: "A student or parent sign-in is managed from the student's file." };
  if (!roleFitsOrg(role, to.type)) return { ok: false, error: roleChanged ? moveRoleRefusal(role, to.type) : roleFitRefusal(role, to.type) };
  // A branch has one head. Taking the only active one away leaves nobody to
  // run it, whatever they become where they are going. A head already
  // switched off is not running anything, so their leaving changes nothing.
  if (person.role === "PARTNER" && person.active && heads.othersAtFrom === 0) {
    return { ok: false, error: `${from.name} would be left without a branch head. Give it another one first, or change this person's role.` };
  }
  // Putting a second one in leaves two people running it. Read against the
  // role they will have there, so a counsellor or a head office person made
  // head in the same step is held to it too.
  if (role === "PARTNER" && heads.atTarget > 0) {
    return {
      ok: false,
      error: roleChanged
        ? `${to.name} already has an active branch head. Pick another role for this person, or move them somewhere without one.`
        : `${to.name} already has a branch head. Change this person's role first, or move them somewhere without one.`,
    };
  }
  const done = (handTo: string | null, n: number) => ({ ok: true as const, plan: { handTo, students: n, role, roleChanged, leavesHeadOffice } });
  // From the head office the tasks are handed over with the students, since
  // nobody there stands where a branch head does.
  const tasks = leavesHeadOffice ? (input.tasks ?? 0) : 0;
  if (students === 0 && tasks === 0) return done(null, 0);
  if (choice === "leave") return done(null, students);
  if (choice !== "hand") {
    if (tasks === 0) {
      return { ok: false, error: `Say what happens to the ${students === 1 ? "student" : `${students} students`} assigned to them: hand them to a colleague, or leave them unassigned.` };
    }
    const what = [students > 0 ? (students === 1 ? "student" : `${students} students`) : null, tasks === 1 ? "open task" : `${tasks} open tasks`].filter(Boolean).join(" and ");
    return { ok: false, error: `Say what happens to the ${what} on their name: hand them to a colleague at ${from.name}, or leave them.` };
  }
  if (!colleague) return { ok: false, error: "Pick the colleague who takes their students." };
  if (colleague.id === person.id) return { ok: false, error: "The students cannot be handed to the person who is leaving." };
  if (colleague.orgId !== from.id) {
    return { ok: false, error: leavesHeadOffice ? "The colleague has to be at the head office." : "The colleague has to be at the branch the students belong to." };
  }
  if (!colleague.active) return { ok: false, error: "That colleague is switched off. Pick somebody who can sign in." };
  if (!(STUDENT_WORK_ROLES as readonly string[]).includes(colleague.role)) return { ok: false, error: "That colleague cannot work student files. Pick somebody who can." };
  return done(colleague.id, students);
}

/**
 * Who may move this person, and with this role. The same lines the rest of
 * the people screen draws: the desk's admins move people, never themselves,
 * and never a family sign-in, which belongs to the student's file. Anything
 * touching the head office (moving somebody into it or out of it) and any
 * change of role is for those who manage user accounts, as changing a role
 * on its own is. A super admin is made or unmade only by a super admin.
 */
export function mayMovePerson(input: {
  actor: { id: string; role: string; managesUsers: boolean; managesSuperAdmins: boolean };
  person: { id: string; role: string; orgType: OrgType };
  toType: OrgType;
  /** The role after the move. Left out, the one they have. */
  role?: string;
}): { ok: true } | { ok: false; error: string } {
  const { actor, person, toType } = input;
  const role = input.role || person.role;
  if (!(ADMIN_ROLES as readonly string[]).includes(actor.role)) return { ok: false, error: "Only the head office moves people between organisations." };
  if (actor.id === person.id) return { ok: false, error: "Ask another admin to move you." };
  if (isFamilyRole(person.role)) return { ok: false, error: "A student or parent sign-in is managed from the student's file." };
  if ((person.orgType === "HQ" || toType === "HQ" || (HQ_ROLES as readonly string[]).includes(person.role)) && !actor.managesUsers) {
    return { ok: false, error: "Only a super admin or an ops manager can move somebody into or out of Medcity Overseas." };
  }
  if (role !== person.role && !actor.managesUsers) return { ok: false, error: "Only a super admin or an ops manager can change a role, so this move keeps their role." };
  if ((role === "SUPER_ADMIN" || person.role === "SUPER_ADMIN") && role !== person.role && !actor.managesSuperAdmins) {
    return { ok: false, error: "Only a super admin can add or remove another super admin." };
  }
  return { ok: true };
}

/**
 * Who takes the open tasks the person leaves behind at the old branch. The
 * colleague taking the students takes the tasks too, since most of them are
 * about those students. With the students left unassigned, the tasks go to
 * the branch head, who is the one picking the students up. With no active
 * head there either, nobody: the tasks stay on the mover's name and the
 * desk is told how many.
 */
export function taskTaker(plan: Pick<MovePlan, "handTo" | "students">, head: { id: string } | null): string | null {
  return plan.handTo ?? head?.id ?? null;
}

export type MoveOutcome = {
  name: string;
  fromName: string;
  toName: string;
  /** Students that changed hands or lost their counsellor. */
  students: number;
  /** Who took the students, by name, or null when they were left unassigned. */
  colleagueName: string | null;
  /** Open tasks found on the mover's name at the old branch. */
  tasks: number;
  /** Who took the tasks, by name, or null when nobody could. */
  tasksTo: string | null;
  /** The new role, as people read it, when the move changed it. */
  newRole?: string | null;
  /** Whether they left the head office, which has no branch head to take tasks. */
  fromHq?: boolean;
};

/** The sentences the desk and the person moved are told, from what the move did. */
export function moveSummary(o: MoveOutcome): { forDesk: string; forPerson: string } {
  const parts: string[] = [];
  if (o.students > 0) {
    parts.push(o.colleagueName ? `${plural(o.students, "student", "students")} handed to ${o.colleagueName}.` : `${plural(o.students, "student", "students")} left unassigned at ${o.fromName}.`);
  }
  if (o.tasks > 0) {
    parts.push(
      o.tasksTo
        ? `${plural(o.tasks, "open task", "open tasks")} handed to ${o.tasksTo}.`
        : o.fromHq
          ? `${plural(o.tasks, "open task", "open tasks")} ${o.tasks === 1 ? "stays" : "stay"} on their name, because nobody at ${o.fromName} was named to take ${o.tasks === 1 ? "it" : "them"}.`
          : `${plural(o.tasks, "open task", "open tasks")} at ${o.fromName} ${o.tasks === 1 ? "stays" : "stay"} on their name, because ${o.fromName} has no branch head to take ${o.tasks === 1 ? "it" : "them"}.`,
    );
  }
  const where = o.newRole ? `${o.newRole} at ${o.toName}` : `at ${o.toName}`;
  const forDesk = [`${o.name} is now ${where}.`, ...parts, "They have been signed out and told."].join(" ");
  const own: string[] = [];
  // From the head office the students and tasks were at every branch, so
  // they are not said to be "at" the head office.
  const at = o.fromHq ? "" : ` at ${o.fromName}`;
  const there = o.fromHq ? "" : " there";
  if (o.students > 0) {
    own.push(
      o.colleagueName
        ? `Your ${o.students === 1 ? "student" : `${o.students} students`}${at} ${o.students === 1 ? "has" : "have"} been handed to ${o.colleagueName}.`
        : o.fromHq
          ? `Your ${o.students === 1 ? "student stays" : `${o.students} students stay`} at ${o.students === 1 ? "their branch" : "their branches"}, unassigned for now.`
          : `Your ${o.students === 1 ? "student" : `${o.students} students`}${at} ${o.students === 1 ? "stays" : "stay"} there, unassigned for now.`,
    );
  }
  if (o.tasks > 0) {
    own.push(
      o.tasksTo
        ? `Your ${o.tasks === 1 ? "open task" : `${o.tasks} open tasks`}${there} ${o.tasks === 1 ? "has" : "have"} gone to ${o.tasksTo}.`
        : `Your ${o.tasks === 1 ? "open task" : `${o.tasks} open tasks`}${there} ${o.tasks === 1 ? "is" : "are"} still on your name until somebody at ${o.fromName} takes ${o.tasks === 1 ? "it" : "them"}.`,
    );
  }
  if (o.newRole) own.unshift(`You are now ${o.newRole} at ${o.toName}.`);
  const forPerson = own.length ? own.join(" ") : `Your work from now on is at ${o.toName}.`;
  return { forDesk, forPerson };
}

/** Somebody who already signs in with an address, as the database describes them. */
export type EmailHolder = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  org: { id: string; name: string; type: OrgType };
};

/**
 * What to say when an address is already somebody's sign-in.
 *
 * "A user with that email already exists" sent the desk hunting through every
 * branch for who it was, and very often the answer was a person who had moved
 * jobs and needed moving, not a second account. So the head office is told
 * who has it, in what role and where, and whether the account is switched
 * off. A branch head is told the same about somebody at their own branch, and
 * nothing at all about anybody else's people: only that it belongs elsewhere
 * and who can sort it out. `mayMove` adds the offer to move them instead,
 * for a caller who is allowed to.
 */
export function emailTakenMessage(
  holder: EmailHolder,
  viewer: { orgId: string; seesEveryOrg: boolean },
  opts: { mayMove?: boolean } = {},
): { text: string; detailed: boolean } {
  if (!viewer.seesEveryOrg && holder.org.id !== viewer.orgId) {
    return { text: "That email belongs to someone at another organisation. Ask the head office to move them.", detailed: false };
  }
  const off = holder.active ? "" : " Their account is switched off.";
  if (isFamilyRole(holder.role)) {
    const kind = holder.role === "PARENT" ? "parent sign-in" : "student portal sign-in";
    return { text: `That email is already the ${kind} of ${holder.name} at ${holder.org.name}.${off} A student or parent sign-in is managed from the student's file.`, detailed: true };
  }
  const label = ROLE_LABEL[holder.role] ?? holder.role;
  const move = opts.mayMove ? " Move them instead of adding a second account." : "";
  return { text: `That email already belongs to ${holder.name}, ${label} at ${holder.org.name}.${off}${move}`, detailed: true };
}
