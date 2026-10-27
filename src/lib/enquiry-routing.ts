/**
 * The rules that decide who a new enquiry goes to, who a repeat enquiry lands
 * on, and what a merge of two enquiries keeps. Pure, so each rule can be read
 * and tested without a database.
 */

export type RoutingSource = "WALK_IN" | "PHONE" | "WHATSAPP" | "WEBSITE" | "REFERRAL" | "EVENT" | "SOCIAL" | "OTHER";
export type RoutingPathway = "DEGREE" | "AUSBILDUNG" | "NURSING" | "FSJ" | "BFD" | "NCLEX" | "WEITERBILDUNG" | "CCM";
export type EnquiryStageName = "NEW" | "CONTACTED" | "QUALIFIED" | "COUNSELLING" | "CONVERTED" | "LOST" | "MERGED";

export const OPEN_ENQUIRY_STAGES: EnquiryStageName[] = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];
export const isOpenStage = (stage: string) => (OPEN_ENQUIRY_STAGES as string[]).includes(stage);

export type RoutingRule = {
  id: string;
  name: string;
  orgId: string | null;
  source: RoutingSource | null;
  pathway: RoutingPathway | null;
  method: string;
  assignToId: string | null;
  priority: number;
  active: boolean;
  createdAt: Date;
};

export type RoutingContext = { orgId: string; source: RoutingSource; pathway: RoutingPathway | null };

/** A rule takes an enquiry when every condition it sets matches; a condition left empty matches anything. */
export function ruleMatches(rule: RoutingRule, ctx: RoutingContext): boolean {
  if (!rule.active) return false;
  if (rule.orgId && rule.orgId !== ctx.orgId) return false;
  if (rule.source && rule.source !== ctx.source) return false;
  if (rule.pathway && rule.pathway !== ctx.pathway) return false;
  return true;
}

/** Rules in the order they are tried: the lower order number first, then the older rule. */
export function orderRules<T extends Pick<RoutingRule, "priority" | "createdAt" | "id">>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** The rules that match, in the order they are tried. */
export function matchingRules<T extends RoutingRule>(rules: T[], ctx: RoutingContext): T[] {
  return orderRules(rules.filter((r) => ruleMatches(r, ctx)));
}

export type Candidate = {
  id: string;
  name: string;
  /** Open enquiries they hold now. */
  open: number;
  /** When they were last given an enquiry, or null when never. */
  lastAssignedAt: Date | null;
};

/**
 * Round robin weighted by workload: whoever holds the fewest open enquiries.
 * Between two people holding the same number, the one who was given an
 * enquiry longest ago (or never) goes first, so equal desks take turns rather
 * than the same name winning every tie. The name settles anything left, so
 * the pick can always be explained.
 */
export function pickRoundRobin(candidates: Candidate[]): Candidate | null {
  if (!candidates.length) return null;
  const t = (d: Date | null) => (d ? d.getTime() : -Infinity);
  return [...candidates].sort((a, b) => a.open - b.open || t(a.lastAssignedAt) - t(b.lastAssignedAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
}

/** What a rule's "goes to" says, in words. */
export function ruleTarget(rule: Pick<RoutingRule, "method" | "assignToId">, personName?: string | null): string {
  if (rule.method === "PERSON") return personName ? personName : "A person no longer at the branch";
  return "Round robin, fewest open enquiries first";
}

// ---------- Repeat enquiries ----------

export type ExistingEnquiry = {
  id: string;
  stage: EnquiryStageName;
  createdAt: Date;
  lastContactedAt: Date | null;
  mergedIntoId?: string | null;
};

export type RepeatPlan =
  | { kind: "create" }
  | { kind: "note"; target: ExistingEnquiry }
  | { kind: "reopen"; target: ExistingEnquiry; stageAfter: "NEW" | "CONTACTED" };

/**
 * What to do with an enquiry arriving for a number the branch already has.
 *
 * An open enquiry for the number takes a note, and no second enquiry is made.
 * Failing that, a lost one is reopened: back to Contacted when somebody had
 * spoken to them, to New when nobody ever had. A converted enquiry is a
 * student already, and a merged one is closed for good, so neither is touched
 * and the arrival is a new enquiry. Where there are several, the most recent
 * is the one somebody remembers.
 */
export function planRepeat(existing: ExistingEnquiry[]): RepeatPlan {
  const live = existing.filter((e) => !e.mergedIntoId && e.stage !== "MERGED");
  const newest = (list: ExistingEnquiry[]) => [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const open = live.filter((e) => isOpenStage(e.stage));
  if (open.length) return { kind: "note", target: newest(open) };
  const lost = live.filter((e) => e.stage === "LOST");
  if (lost.length) {
    const target = newest(lost);
    return { kind: "reopen", target, stageAfter: target.lastContactedAt ? "CONTACTED" : "NEW" };
  }
  return { kind: "create" };
}

// ---------- Merging duplicates ----------

export type MergeRecord = {
  id: string;
  name: string;
  orgId: string;
  stage: EnquiryStageName;
  email: string | null;
  city: string | null;
  interestCountry: string | null;
  interestPathway: RoutingPathway | null;
  intakeMonth: number | null;
  intakeYear: number | null;
  budgetLakhs: number | null;
  assignedToId: string | null;
  nextFollowUpAt: Date | null;
  lastContactedAt: Date | null;
  studentId: string | null;
  submittedByOrgId: string | null;
  crmId: string | null;
  mergedIntoId: string | null;
  repeatCount: number;
  answers: { question: string; answer: string }[];
};

export type MergePlan =
  | { ok: false; why: string }
  | {
      ok: true;
      /** Fields to write on the enquiry that is kept. */
      set: Partial<
        Pick<
          MergeRecord,
          | "email"
          | "city"
          | "interestCountry"
          | "interestPathway"
          | "intakeMonth"
          | "intakeYear"
          | "budgetLakhs"
          | "assignedToId"
          | "nextFollowUpAt"
          | "lastContactedAt"
          | "submittedByOrgId"
          | "crmId"
          | "stage"
          | "repeatCount"
          | "answers"
        >
      > & { clearLost?: boolean };
      /** The details filled in from the duplicate, by name, for the note. */
      filled: string[];
    };

const FILLABLE = ["email", "city", "interestCountry", "interestPathway", "intakeMonth", "intakeYear", "budgetLakhs"] as const;
const FILL_LABEL: Record<(typeof FILLABLE)[number], string> = {
  email: "email",
  city: "town",
  interestCountry: "destination",
  interestPathway: "pathway",
  intakeMonth: "intake month",
  intakeYear: "intake year",
  budgetLakhs: "budget",
};

/**
 * Folding one enquiry into another.
 *
 * The kept enquiry keeps everything it has; a detail it lacks is taken from the
 * duplicate. Its owner stays, or the duplicate's owner when it has none and
 * that person is still active. The next follow-up is the sooner of the two, the
 * last contact the later. A kept enquiry that was lost while the duplicate is
 * still being worked comes back to the duplicate's stage, because somebody is
 * talking to that person.
 *
 * Refused: the same enquiry twice, either already merged, and a duplicate that
 * became a student, because the student file points at it. The kept one may
 * be the converted one.
 *
 * A sub-agent's referral folded into an enquiry that has no referrer decides
 * who is paid for the person, so only the head office may do it. When the
 * kept enquiry is already a student, nobody may: the student file would keep
 * no referrer while the enquiry named one, so the referral is set on the
 * student instead, and is never half applied.
 */
export function planMerge(keep: MergeRecord, remove: MergeRecord, opts: { removeOwnerActive: boolean; headOffice: boolean }): MergePlan {
  if (keep.id === remove.id) return { ok: false, why: "That is the same enquiry." };
  if (keep.mergedIntoId || keep.stage === "MERGED") return { ok: false, why: "The enquiry to keep has itself been merged into another." };
  if (remove.mergedIntoId || remove.stage === "MERGED") return { ok: false, why: "That enquiry has already been merged." };
  if (remove.studentId || remove.stage === "CONVERTED") return { ok: false, why: `${remove.name} is already a student. Open that enquiry and merge this one into it instead.` };
  if (keep.submittedByOrgId && remove.submittedByOrgId && keep.submittedByOrgId !== remove.submittedByOrgId) {
    return { ok: false, why: "The two were referred by different sub-agents. Who is paid for the person is the desk's decision, so they are left apart." };
  }
  if (remove.submittedByOrgId && !keep.submittedByOrgId) {
    if (keep.studentId || keep.stage === "CONVERTED") {
      return {
        ok: false,
        why: `${keep.name} is already a student, and ${remove.name}'s enquiry was referred by a sub-agent. A merge would leave the student without that referral, so it is not merged: set the referring sub-agent on the student instead.`,
      };
    }
    if (!opts.headOffice) {
      return {
        ok: false,
        why: `${remove.name}'s enquiry was referred by a sub-agent and this one was not. Merging would decide who is paid for the person, so only the head office may merge these two.`,
      };
    }
  }

  const set: Extract<MergePlan, { ok: true }>["set"] = {};
  const filled: string[] = [];
  for (const k of FILLABLE) {
    const have = keep[k];
    const other = remove[k];
    if ((have == null || have === "") && other != null && other !== "") {
      (set as Record<string, unknown>)[k] = other;
      filled.push(FILL_LABEL[k]);
    }
  }
  if (!keep.assignedToId && remove.assignedToId && opts.removeOwnerActive && remove.orgId === keep.orgId) {
    set.assignedToId = remove.assignedToId;
    filled.push("owner");
  }
  const keepOpen = isOpenStage(keep.stage);
  const removeOpen = isOpenStage(remove.stage);
  if (keep.stage === "LOST" && removeOpen) {
    set.stage = remove.stage;
    set.clearLost = true;
  }
  const willBeOpen = keepOpen || set.stage !== undefined;
  if (willBeOpen) {
    const dates = [keep.nextFollowUpAt, removeOpen ? remove.nextFollowUpAt : null].filter((d): d is Date => !!d);
    const soonest = dates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    if (soonest && soonest.getTime() !== keep.nextFollowUpAt?.getTime()) set.nextFollowUpAt = soonest;
  }
  if (remove.lastContactedAt && (!keep.lastContactedAt || remove.lastContactedAt > keep.lastContactedAt)) set.lastContactedAt = remove.lastContactedAt;
  // The first sub-agent to refer the person is who gets paid; a second never replaces the first.
  if (!keep.submittedByOrgId && remove.submittedByOrgId) set.submittedByOrgId = remove.submittedByOrgId;
  if (!keep.crmId && remove.crmId) set.crmId = remove.crmId;
  set.repeatCount = keep.repeatCount + remove.repeatCount + 1;
  const known = new Set(keep.answers.map((a) => `${a.question}\n${a.answer}`));
  const extra = remove.answers.filter((a) => !known.has(`${a.question}\n${a.answer}`));
  if (extra.length) set.answers = [...keep.answers, ...extra];
  return { ok: true, set, filled };
}

// ---------- Who may ----------

type Who = { role: string; orgId: string; orgType?: string };
const HEAD_OFFICE = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"];

/** The head office: sets every rule and keeps the lost reasons list. */
export const isHeadOffice = (u: Pick<Who, "role">) => HEAD_OFFICE.includes(u.role);

/**
 * A branch head: the owner of a branch, who sets their own branch's rules. A
 * sub-agent's owner also signs in as PARTNER, and is not one.
 */
export const isBranchHead = (u: Who) => u.role === "PARTNER" && u.orgType === "BRANCH";

/** Who may see and set routing rules at all. */
export const mayManageRouting = (u: Who) => isHeadOffice(u) || isBranchHead(u);

/** Whether this person may change a rule for this organisation (null: every organisation). */
export function mayEditRuleFor(u: Who, orgId: string | null): boolean {
  if (isHeadOffice(u)) return true;
  return isBranchHead(u) && orgId === u.orgId;
}

/** Whether this person may merge two enquiries of these organisations. */
export function mayMerge(u: Who, keepOrgId: string, removeOrgId: string): boolean {
  if (isHeadOffice(u)) return true;
  return isBranchHead(u) && keepOrgId === u.orgId && removeOrgId === u.orgId;
}
