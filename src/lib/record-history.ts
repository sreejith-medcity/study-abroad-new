import { sameValue, storable, type FieldChange } from "./catalogue-history";
import { LEVEL_LABEL, PATHWAY_LABEL } from "./catalogue";
import { fmtDate, fmtDateTime, MONTHS } from "./format";
import { STAGES } from "./journey";

/**
 * The pure half of the version history kept for the records people edit every
 * day: students, enquiries, applications and staff accounts. Which fields are
 * kept, what each is called, how a stored value reads, which fields may be put
 * back from the history and why the others may not, and how two versions
 * compare. Kept apart from the database so every rule here can be tested on
 * its own and read by the page and the server alike.
 */

export type { FieldChange };
export type HistoryEntity = "student" | "enquiry" | "application" | "user";

/** How a stored value is read back to a person. */
type Kind = "text" | "day" | "time" | "bool" | "number" | "month" | "user" | "org" | "status" | "route" | "team" | "lostReason" | "enquiry" | "enum" | "answers" | "passport";

export type FieldDef = {
  label: string;
  kind: Kind;
  /** Words for an enum's stored values. */
  values?: Record<string, string>;
  /**
   * Set when the field may not be put back from the history, saying why in
   * the words shown beside it. A field without one may be restored.
   */
  noRestore?: string;
};

/** Reasons shared by several fields, so the same thing is said the same way everywhere. */
const WHY = {
  assignment:
    "Who carries the file is changed with Reassign, which tells the person it goes to and writes the ownership ledger, so it is not put back from here.",
  branch: "Moving a record to another branch changes who may open it, so it is done from the people screens rather than put back from here.",
  stage: "A stage move runs the document gate and tells the student, so move the stage from the file rather than putting it back from here.",
  status: "A status change tells people, can lock the profile and can open commission, so change it from the application rather than putting it back from here.",
  route: "The route decides the commission and who is invoiced, and a change needs a reason, so choose it again from the desk.",
  money: "This is money: correct it where the payment is recorded, so the books stay right.",
  handover: "The hand-over between the branch and the desk is done with Hand over and Return, which tell the other side.",
  offer: "Offer and visa entries tell the branch and set deadlines, so correct them in the Offer and visa form.",
  enquiryStage: "A stage change writes a follow-up note, and a converted enquiry points at its student, so set the stage from the enquiry.",
  email: "An email has to be checked against everybody else's before it is used, so change it on the profile.",
  signIn: "This decides what somebody may open or how they sign in, so it is changed on the People screen, where the rules for it apply.",
  fixed: "This is set once by the portal and never edited by hand.",
  team: "Choose the team on the profile, where only the current teams are offered.",
  lock: "Locking follows the application and the edit requests, so it is changed with the lock control on the file.",
  archive: "Archive and bring back a file from the student list.",
  referral: "Who referred a student decides who is paid for them, so it is not changed from here.",
  merge: "A merge moves the duplicate's history across and closes it, so it is not undone from here.",
  repeat: "This counts the times the person came again, and is kept by the portal as they arrive.",
} as const;

const PATHWAY = PATHWAY_LABEL;
const LEVEL = LEVEL_LABEL;
const JOURNEY: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.value, `${s.number}. ${s.label}`]));
const ENQUIRY_STAGE: Record<string, string> = { NEW: "New", CONTACTED: "Contacted", QUALIFIED: "Qualified", COUNSELLING: "In counselling", CONVERTED: "Converted", LOST: "Lost", MERGED: "Merged" };
const ENQUIRY_SOURCE: Record<string, string> = {
  WALK_IN: "Walk in",
  PHONE: "Phone call",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  REFERRAL: "Referral",
  EVENT: "Event or seminar",
  SOCIAL: "Social media",
  OTHER: "Other",
};
const ROLE: Record<string, string> = {
  SUPER_ADMIN: "Super admin",
  OPS_MANAGER: "Ops manager",
  ADMIN: "Overseas admin",
  DOCUMENTATION: "Documentation team",
  APPLICATION_TEAM_LEADER: "Application team leader",
  FINANCE: "Finance",
  MANAGEMENT: "Management",
  PARTNER: "Branch head",
  COUNSELLOR: "Counsellor",
  DESK_COUNSELLOR: "Overseas desk counsellor",
  SENIOR_COUNSELLOR: "Senior counsellor",
  TRAINEE_COUNSELLOR: "Trainee counsellor",
  SUB_AGENT_COUNSELLOR: "Sub-agent counsellor",
  STUDENT: "Student",
  PARENT: "Parent or guardian",
};

/**
 * The fields kept for each kind of record. Anything not named here is never
 * recorded, which is what keeps password hashes, session counters, sign-in
 * times and screen preferences out of the history whatever an action writes.
 */
export const HISTORY_FIELDS: Record<HistoryEntity, Record<string, FieldDef>> = {
  student: {
    firstName: { label: "First name", kind: "text" },
    lastName: { label: "Last name", kind: "text" },
    email: { label: "Email", kind: "text", noRestore: WHY.email },
    phone: { label: "Mobile", kind: "text" },
    whatsappOptIn: { label: "WhatsApp messages", kind: "bool" },
    preferredLanguage: { label: "Preferred language", kind: "enum", values: { en: "English", ml: "Malayalam" } },
    preferredCountry: { label: "Preferred destination", kind: "text" },
    preferredPathway: { label: "Journey", kind: "enum", values: PATHWAY },
    preferredLevel: { label: "Level aimed for", kind: "enum", values: LEVEL },
    dateOfBirth: { label: "Date of birth", kind: "day" },
    gender: { label: "Gender", kind: "text" },
    maritalStatus: { label: "Marital status", kind: "text" },
    nationality: { label: "Nationality", kind: "text" },
    addressLine1: { label: "Address line 1", kind: "text" },
    addressLine2: { label: "Address line 2", kind: "text" },
    city: { label: "City", kind: "text" },
    state: { label: "State", kind: "text" },
    pincode: { label: "PIN code", kind: "text" },
    mailingSameAsPermanent: { label: "Mailing address same as permanent", kind: "bool" },
    mailingAddress: { label: "Mailing address", kind: "text" },
    otherCitizenship: { label: "Other citizenship", kind: "text" },
    livingInCountry: { label: "Living in", kind: "text" },
    background: { label: "Background answers", kind: "answers" },
    passportNumber: { label: "Passport number", kind: "passport" },
    passportIssue: { label: "Passport issued", kind: "day" },
    passportExpiry: { label: "Passport expires", kind: "day" },
    passportIssueCountry: { label: "Passport issued in", kind: "text" },
    cityOfBirth: { label: "City of birth", kind: "text" },
    backlogs: { label: "Backlogs", kind: "number" },
    gapYears: { label: "Gap years", kind: "number" },
    assignedToId: { label: "Assigned to", kind: "user", noRestore: WHY.assignment },
    orgId: { label: "Branch", kind: "org", noRestore: WHY.branch },
    teamId: { label: "Team", kind: "team", noRestore: WHY.team },
    journeyStage: { label: "Stage", kind: "enum", values: JOURNEY, noRestore: WHY.stage },
    profileLocked: { label: "Profile locked", kind: "bool", noRestore: WHY.lock },
    archived: { label: "Archived", kind: "bool", noRestore: WHY.archive },
    medcityId: { label: "Medcity ID", kind: "text", noRestore: WHY.fixed },
    referredByOrgId: { label: "Referred by", kind: "org", noRestore: WHY.referral },
  },
  enquiry: {
    name: { label: "Name", kind: "text" },
    phone: { label: "Mobile", kind: "text" },
    email: { label: "Email", kind: "text" },
    city: { label: "Town", kind: "text" },
    source: { label: "Source", kind: "enum", values: ENQUIRY_SOURCE },
    stage: { label: "Stage", kind: "enum", values: ENQUIRY_STAGE, noRestore: WHY.enquiryStage },
    interestCountry: { label: "Destination", kind: "text" },
    interestPathway: { label: "Pathway", kind: "enum", values: PATHWAY },
    intakeMonth: { label: "Intake month", kind: "month" },
    intakeYear: { label: "Intake year", kind: "number" },
    budgetLakhs: { label: "Budget (lakhs)", kind: "number" },
    notes: { label: "Notes", kind: "text" },
    nextFollowUpAt: { label: "Next follow up", kind: "time" },
    lostReasonId: { label: "Reason lost", kind: "lostReason", noRestore: WHY.enquiryStage },
    lostReason: { label: "Why it was lost, in words", kind: "text", noRestore: WHY.enquiryStage },
    lostAt: { label: "Lost on", kind: "time", noRestore: WHY.enquiryStage },
    repeatCount: { label: "Times enquired again", kind: "number", noRestore: WHY.repeat },
    mergedIntoId: { label: "Merged into", kind: "enquiry", noRestore: WHY.merge },
    crmId: { label: "CRM id", kind: "text", noRestore: WHY.fixed },
    assignedToId: { label: "Owner", kind: "user", noRestore: WHY.assignment },
    orgId: { label: "Branch", kind: "org", noRestore: WHY.branch },
    studentId: { label: "Student file", kind: "text", noRestore: WHY.enquiryStage },
  },
  application: {
    statusId: { label: "Status", kind: "status", noRestore: WHY.status },
    officerId: { label: "Officer", kind: "user", noRestore: WHY.assignment },
    routeId: { label: "Route", kind: "route", noRestore: WHY.route },
    routeChangeReason: { label: "Why the route changed", kind: "text", noRestore: WHY.route },
    intakeMonth: { label: "Intake month", kind: "month", noRestore: WHY.status },
    intakeYear: { label: "Intake year", kind: "number", noRestore: WHY.status },
    deadline: { label: "Deadline", kind: "day" },
    vendorReference: { label: "Vendor reference", kind: "text" },
    priority: { label: "Priority", kind: "enum", values: { HIGH: "High", NORMAL: "Normal", LOW: "Low" } },
    deskStage: { label: "Desk stage", kind: "enum", values: { PREPARING: "Preparing", READY: "Handed over", CHOSEN: "Route chosen", SUBMITTED: "Submitted", RETURNED: "Returned to the branch" }, noRestore: WHY.handover },
    handedOverAt: { label: "Handed over", kind: "time", noRestore: WHY.handover },
    handoverNote: { label: "Hand-over note", kind: "text", noRestore: WHY.handover },
    returnedAt: { label: "Returned to the branch", kind: "time", noRestore: WHY.handover },
    returnReason: { label: "Why it was returned", kind: "text", noRestore: WHY.handover },
    submittedToVendorAt: { label: "Submitted", kind: "time", noRestore: WHY.handover },
    feeStatus: { label: "Application fee", kind: "enum", values: { NOT_APPLICABLE: "No fee", DUE: "Due", PAID: "Paid" }, noRestore: WHY.money },
    offerType: { label: "Offer", kind: "enum", values: { CONDITIONAL: "Conditional", UNCONDITIONAL: "Unconditional" }, noRestore: WHY.offer },
    offerDate: { label: "Offer date", kind: "day", noRestore: WHY.offer },
    offerConditions: { label: "Offer conditions", kind: "text", noRestore: WHY.offer },
    offerAcceptBy: { label: "Accept the offer by", kind: "day", noRestore: WHY.offer },
    depositAmount: { label: "Deposit", kind: "number", noRestore: WHY.money },
    depositPaidOn: { label: "Deposit paid on", kind: "day", noRestore: WHY.money },
    confirmationNumber: { label: "Confirmation number", kind: "text", noRestore: WHY.offer },
    confirmationIssuedOn: { label: "Confirmation issued on", kind: "day", noRestore: WHY.offer },
    visaLodgedOn: { label: "Visa lodged on", kind: "day", noRestore: WHY.offer },
    visaDecision: { label: "Visa decision", kind: "enum", values: { GRANTED: "Granted", REFUSED: "Refused" }, noRestore: WHY.offer },
    visaDecisionOn: { label: "Visa decided on", kind: "day", noRestore: WHY.offer },
  },
  user: {
    name: { label: "Name", kind: "text" },
    email: { label: "Sign-in email", kind: "text", noRestore: WHY.signIn },
    phone: { label: "Phone", kind: "text" },
    role: { label: "Role", kind: "enum", values: ROLE, noRestore: WHY.signIn },
    orgId: { label: "Branch", kind: "org", noRestore: WHY.branch },
    deskLabel: { label: "Job title", kind: "text" },
    department: { label: "Department", kind: "text", noRestore: WHY.signIn },
    active: { label: "Active", kind: "bool", noRestore: WHY.signIn },
  },
};

export const ENTITY_LABEL: Record<HistoryEntity, string> = { student: "Student", enquiry: "Enquiry", application: "Application", user: "Staff account" };

export const isHistoryEntity = (v: string): v is HistoryEntity => Object.hasOwn(HISTORY_FIELDS, v);

/** What a field is called, or its own name where it is not one of ours. */
export const fieldLabel = (entity: HistoryEntity, field: string) => HISTORY_FIELDS[entity][field]?.label ?? field;

/**
 * The tracked fields that differ between a record as it was and as it now is.
 * Only the fields listed above are looked at, so whatever else the write
 * touched never shows. Values are stored the way jsonb holds them.
 */
export function trackedChanges(entity: HistoryEntity, before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of Object.keys(HISTORY_FIELDS[entity])) {
    if (!(field in after)) continue;
    const a = before[field];
    const b = after[field];
    if (sameValue(a, b)) continue;
    out.push({ field, before: storable(a) ?? null, after: storable(b) ?? null });
  }
  return out;
}

export type RestoreRule = { ok: true } | { ok: false; reason: string };

/**
 * Whether a field may be put back from the history at all. Assignment, branch,
 * stage, status, route, money and anything else with side effects is never
 * offered; the reason says where it is changed instead.
 */
export function restoreRule(entity: HistoryEntity, field: string): RestoreRule {
  const def = HISTORY_FIELDS[entity]?.[field];
  if (!def) return { ok: false, reason: "This field is not kept in the history." };
  if (entity === "user") return { ok: false, reason: def.noRestore ?? "A staff account is corrected on the People screen." };
  return def.noRestore ? { ok: false, reason: def.noRestore } : { ok: true };
}

export type FieldRestorePlan = { ok: true; value: unknown } | { ok: false; reason: string; already?: boolean };

/**
 * What putting one change back would write. The field goes back to what it
 * was before the change only while it still holds what the change gave it:
 * when somebody has changed it again since, writing the old value would throw
 * their newer value away, so it is refused and the answer says what it is now.
 */
export function planFieldRestore(entity: HistoryEntity, current: Record<string, unknown>, change: FieldChange): FieldRestorePlan {
  const rule = restoreRule(entity, change.field);
  if (!rule.ok) return rule;
  const now = current[change.field];
  if (sameValue(now, change.before)) return { ok: false, already: true, reason: `${fieldLabel(entity, change.field)} already reads ${showValue(entity, change.field, change.before)}.` };
  if (!sameValue(now, change.after)) {
    return { ok: false, reason: `${fieldLabel(entity, change.field)} was changed again since, to ${showValue(entity, change.field, storable(now))}, so it was left as it is.` };
  }
  return { ok: true, value: change.before };
}

/** Turns a stored jsonb value back into what the column takes. */
export function columnValue(entity: HistoryEntity, field: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const kind = HISTORY_FIELDS[entity][field]?.kind;
  if ((kind === "day" || kind === "time") && typeof value === "string") {
    // date columns (offerDate) hold "YYYY-MM-DD"; timestamp columns want a Date.
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value);
  }
  return value;
}

export const NOT_RECORDED = "Not recorded";

/** Names for the ids a history holds: people, branches, statuses, routes, teams, lost reasons and enquiries. */
export type NameBook = Map<string, string>;

/**
 * How a stored value reads. Nothing recorded reads "Not recorded", never a
 * guess; an id nobody can name any more reads "Not recorded" too rather than
 * showing the id. A passport number is masked unless `fullPassport` is set.
 */
export function showValue(entity: HistoryEntity, field: string, value: unknown, names?: NameBook, opts: { fullPassport?: boolean } = {}): string {
  const def = HISTORY_FIELDS[entity]?.[field];
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return NOT_RECORDED;
  if (!def) return typeof value === "string" ? value : JSON.stringify(value);
  switch (def.kind) {
    case "bool":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "day":
      return typeof value === "string" || value instanceof Date ? fmtDate(value) || NOT_RECORDED : String(value);
    case "time":
      return typeof value === "string" || value instanceof Date ? fmtDateTime(value) || NOT_RECORDED : String(value);
    case "month":
      return typeof value === "number" && value >= 1 && value <= 12 ? MONTHS[value - 1] : String(value);
    case "enum":
      return def.values?.[String(value)] ?? String(value);
    case "user":
    case "org":
    case "status":
    case "route":
    case "team":
    case "lostReason":
    case "enquiry":
      return names?.get(String(value)) ?? NOT_RECORDED;
    case "passport": {
      const s = String(value);
      if (opts.fullPassport) return s;
      return s.length <= 3 ? "•••" : s[0] + "•".repeat(Math.max(3, s.length - 3)) + s.slice(-2);
    }
    case "answers": {
      if (typeof value !== "object") return String(value);
      const entries = Object.entries(value as Record<string, { answer?: boolean; details?: string | null }>);
      if (!entries.length) return NOT_RECORDED;
      const yes = entries.filter(([, a]) => a?.answer === true).length;
      return `${entries.length} answered, ${yes} yes`;
    }
    case "number":
    case "text":
    default: {
      const s = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
      return s.length > 300 ? `${s.slice(0, 300)}...` : s;
    }
  }
}

/** The ids in a set of changes that need a name, by kind. */
export function idsToName(entity: HistoryEntity, changes: readonly FieldChange[]) {
  const out = {
    user: new Set<string>(),
    org: new Set<string>(),
    status: new Set<string>(),
    route: new Set<string>(),
    team: new Set<string>(),
    lostReason: new Set<string>(),
    enquiry: new Set<string>(),
  };
  for (const c of changes) {
    const kind = HISTORY_FIELDS[entity]?.[c.field]?.kind;
    if (kind === "user" || kind === "org" || kind === "status" || kind === "route" || kind === "team" || kind === "lostReason" || kind === "enquiry") {
      for (const v of [c.before, c.after]) if (typeof v === "string" && v) out[kind].add(v);
    }
  }
  return out;
}

// ---------- Versions and compare ----------

/**
 * One saved version: the record after change number n. Version 0 is the
 * record as it stood before the first change the history holds.
 */
export type VersionChanges = { n: number; changes: readonly FieldChange[] };

/**
 * A field's value at version n, read from the changes alone: the latest change
 * at or before n says what it became, and failing that the first change after
 * n says what it was. A field no change in the history touches is unknown.
 */
export function valueAt(versions: readonly VersionChanges[], field: string, n: number): { known: boolean; value: unknown } {
  let last: FieldChange | null = null;
  for (const v of versions) {
    if (v.n > n) break;
    for (const c of v.changes) if (c.field === field) last = c;
  }
  if (last) return { known: true, value: last.after };
  for (const v of versions) {
    if (v.n <= n) continue;
    const c = v.changes.find((x) => x.field === field);
    if (c) return { known: true, value: c.before };
  }
  return { known: false, value: null };
}

export type Difference = { field: string; a: unknown; b: unknown };

/**
 * The fields that differ between two versions, in the order the record
 * lists its fields. Either order of a and b is fine. Only fields some change
 * in between touched can differ, and a field changed and changed back is
 * reported as the same.
 */
export function compareVersions(entity: HistoryEntity, versions: readonly VersionChanges[], a: number, b: number): Difference[] {
  const sorted = [...versions].sort((x, y) => x.n - y.n);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const touched = new Set<string>();
  for (const v of sorted) if (v.n > lo && v.n <= hi) for (const c of v.changes) touched.add(c.field);
  const order = Object.keys(HISTORY_FIELDS[entity]);
  const fields = [...touched].sort((x, y) => (order.indexOf(x) === -1 ? 999 : order.indexOf(x)) - (order.indexOf(y) === -1 ? 999 : order.indexOf(y)));
  const out: Difference[] = [];
  for (const field of fields) {
    const va = valueAt(sorted, field, a).value;
    const vb = valueAt(sorted, field, b).value;
    if (!sameValue(va, vb)) out.push({ field, a: va, b: vb });
  }
  return out;
}

// ---------- The feed ----------

export type HistoryFilters = { entity?: string; by?: string; org?: string; from?: string; to?: string; page?: string };

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());

/** The feed's filters, as far as they make sense: an unknown record type or a day that is not a day is dropped rather than refused. */
export function readHistoryFilters(sp: Record<string, string | string[] | undefined>): HistoryFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const out: HistoryFilters = {};
  const entity = one("entity");
  if (entity && isHistoryEntity(entity)) out.entity = entity;
  const by = one("by");
  if (by) out.by = by.slice(0, 64);
  const org = one("org");
  if (org) out.org = org.slice(0, 64);
  const from = one("from");
  if (isDay(from)) out.from = from;
  const to = one("to");
  if (isDay(to)) out.to = to;
  const page = one("page");
  if (page && /^\d{1,5}$/.test(page) && Number(page) > 1) out.page = page;
  return out;
}

/** A day as the India day it names: from midnight IST, to the midnight after. */
export function dayRange(from?: string, to?: string): { start?: Date; end?: Date } {
  return {
    start: from ? new Date(`${from}T00:00:00+05:30`) : undefined,
    end: to ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000) : undefined,
  };
}

/** A CSV cell, quoted where it has to be, and never read by a spreadsheet as a formula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
