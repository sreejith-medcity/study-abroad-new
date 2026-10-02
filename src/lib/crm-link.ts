
/**
 * The link to Medcity's own CRM, the separate product the company runs its
 * branches on: which fields may cross between the two, who wins when they
 * disagree, how a caller proves itself, and when to try a failed send again.
 *
 * Named crm-link rather than crm because crm.ts next to it is this portal's own
 * day-to-day layer, which is a different thing entirely.
 *
 * All of it pure and testable. The CRM's production build is somebody else's
 * work in progress, so nothing here assumes their shape: the portal states its
 * own contract and the vendor meets it.
 */

// ---------- What may cross ----------

/**
 * The fields the CRM may set on a student.
 *
 * Deliberately a list rather than "whatever they send". A field not on it is
 * ignored and recorded, so a CRM release that starts sending something new
 * cannot quietly write to a column nobody agreed on. Applications, documents,
 * money and the journey stage are the portal's own and are not here at all.
 */
export const SYNCABLE_STUDENT_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "dateOfBirth",
  "gender",
  "maritalStatus",
  "nationality",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "pincode",
  "passportNumber",
  "passportIssue",
  "passportExpiry",
  "passportIssueCountry",
  "cityOfBirth",
  "preferredCountry",
  "preferredPathway",
  "backlogs",
  "gapYears",
] as const;

export type SyncableField = (typeof SYNCABLE_STUDENT_FIELDS)[number];

/** Fields whose value is a day rather than a string, so both sides compare alike. */
export const DATE_FIELDS: readonly SyncableField[] = ["dateOfBirth", "passportIssue", "passportExpiry"];

/** Fields that are whole numbers, so "3" and 3 are the same answer. */
export const NUMBER_FIELDS: readonly SyncableField[] = ["backlogs", "gapYears"];

/**
 * Fields that may only hold one of a few values. Listed here rather than read
 * from the database so the vendor's page and the check agree, and so a value
 * outside the list is named back to them instead of breaking the write.
 */
export const ENUM_FIELDS: Partial<Record<SyncableField, readonly string[]>> = {
  preferredPathway: ["DEGREE", "AUSBILDUNG", "NURSING"],
};

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const asDay = (v: unknown): string | null => {
  if (isBlank(v)) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** One field read the same way on both sides, so a difference is a real difference. */
export function normalise(field: SyncableField, value: unknown): string | number | null {
  if (isBlank(value)) return null;
  if (DATE_FIELDS.includes(field)) return asDay(value);
  if (NUMBER_FIELDS.includes(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  const allowed = ENUM_FIELDS[field];
  if (allowed) {
    const up = String(value).trim().toUpperCase();
    return allowed.includes(up) ? up : null;
  }
  return String(value).trim();
}

export type FieldChange = { field: SyncableField; mine: string | number | null; theirs: string | number | null };

export type FieldPlan = {
  /** What to write, already normalised. */
  apply: Partial<Record<SyncableField, string | number | null>>;
  /** What was written, with what it replaced, so a bad overwrite can be undone. */
  changed: FieldChange[];
  /** What the portal refused, because its own copy is newer. */
  conflicts: FieldChange[];
  /** Names the CRM sent that are not ours to write. */
  ignored: string[];
  /** Whether the whole message is older than what the portal already holds. */
  stale: boolean;
};

export type PlanInput = {
  /** What the CRM sent, by field name. */
  incoming: Record<string, unknown>;
  /** What the portal holds now. */
  current: Partial<Record<SyncableField, unknown>>;
  /** The CRM's own updatedAt for this record. Required: without it there is no "last". */
  theirUpdatedAt: Date | string | null;
  /** When the portal's copy last changed. */
  myUpdatedAt: Date | string | null;
};

const asTime = (v: Date | string | null | undefined): number | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

/**
 * Last edit wins, done properly and never silently.
 *
 * The rule is the one that was asked for: the more recent edit stands. What is
 * added is that it is decided against a real timestamp rather than against
 * whichever message arrived last, and that every field written is recorded with
 * what it replaced. A message older than the portal's own copy writes nothing
 * and every field it would have changed is listed for a person, because the
 * alternative is a counsellor's correction disappearing with nobody told.
 *
 * A blank from the CRM never clears a value the portal holds: deleting by
 * omission is how an integration empties a database, and no release note ever
 * says it is going to.
 */
export function planFieldUpdates(input: PlanInput): FieldPlan {
  const theirs = asTime(input.theirUpdatedAt);
  const mine = asTime(input.myUpdatedAt);
  const stale = theirs != null && mine != null && theirs < mine;

  const plan: FieldPlan = { apply: {}, changed: [], conflicts: [], ignored: [], stale };
  const allowed = new Set<string>(SYNCABLE_STUDENT_FIELDS);

  for (const [name, raw] of Object.entries(input.incoming)) {
    if (!allowed.has(name)) {
      // Not a field anybody agreed on. Recorded so a new CRM release shows up
      // here rather than writing somewhere it should not.
      if (!["crmId", "updatedAt", "branch", "branchCode", "idempotencyKey", "medcityId"].includes(name)) plan.ignored.push(name);
      continue;
    }
    const field = name as SyncableField;
    const incoming = normalise(field, raw);
    if (incoming === null) {
      // A value the portal cannot use: an unreadable date, a word where a number
      // belongs, a pathway outside the three. Named back rather than dropped on
      // the floor, so a CRM sending rubbish finds out from the answer.
      if (!isBlank(raw)) plan.ignored.push(name);
      continue;
    }
    const held = normalise(field, input.current[field]);
    if (held === incoming) continue;

    if (held === null) {
      // Nothing of ours to lose: a blank is filled whatever the dates say.
      plan.apply[field] = incoming;
      plan.changed.push({ field, mine: held, theirs: incoming });
      continue;
    }
    if (stale) {
      plan.conflicts.push({ field, mine: held, theirs: incoming });
      continue;
    }
    plan.apply[field] = incoming;
    plan.changed.push({ field, mine: held, theirs: incoming });
  }

  return plan;
}

/** One line a person reads on the queue, saying what the disagreement was. */
export function conflictSummary(conflicts: FieldChange[]): string {
  if (conflicts.length === 0) return "";
  const first = conflicts
    .slice(0, 3)
    .map((c) => `${c.field}: ours "${c.mine ?? ""}", theirs "${c.theirs ?? ""}"`)
    .join("; ");
  return conflicts.length > 3 ? `${first}; and ${conflicts.length - 3} more` : first;
}

// ---------- Proving who you are ----------

/** The header names, stated once so both sides spell them the same way. */
export const KEY_HEADER = "x-medcity-key";
export const SIGNATURE_HEADER = "x-medcity-signature";
export const TIMESTAMP_HEADER = "x-medcity-timestamp";

/** How far out of step a clock may be before a request is refused. */
export const SIGNATURE_WINDOW_SECONDS = 300;

// The signing itself lives in crm-signing.ts, because it needs node:crypto and
// this file is read by the browser: a client component shows the vendor which
// kinds of event can be sent, and must not drag a node module into its bundle.

// ---------- Sending, and trying again ----------

/** The kinds of thing the portal sends, and what each one is called. */
export const OUTBOUND_KINDS = {
  "student.stage": "A student moves to another stage",
  "application.status": "An application's status changes",
  "money.event": "A commission, an invoice payment or a referral fee",
  "document.decision": "A document is accepted or sent back",
} as const;

export type OutboundKind = keyof typeof OUTBOUND_KINDS;

export const isOutboundKind = (v: string): v is OutboundKind => v in OUTBOUND_KINDS;

/** Whether this kind is one the desk has switched on. */
export const shouldSend = (kind: string, enabled: readonly string[]) => enabled.includes(kind);

/** How many times a failing send is tried before a person is asked to look. */
export const MAX_ATTEMPTS = 6;

/**
 * How long to wait before attempt n, in seconds: a minute, then four, then
 * nine, growing by the square so a CRM that is down for an afternoon is not
 * hammered, and a blip is retried quickly.
 */
export function backoffSeconds(attempt: number): number {
  const n = Math.max(1, Math.trunc(attempt));
  return Math.min(60 * n * n, 6 * 60 * 60);
}

export function nextAttemptAt(attempt: number, from: Date = new Date()): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  return new Date(from.getTime() + backoffSeconds(attempt) * 1000);
}

/** Whether an answer from the CRM is worth trying again, or is their final word. */
export function worthRetrying(httpStatus: number | null): boolean {
  if (httpStatus == null) return true; // never reached them at all
  if (httpStatus === 408 || httpStatus === 429) return true;
  return httpStatus >= 500;
}
