import "server-only";
import { cache } from "react";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { getSettings } from "./settings";
import { notifyUsers } from "./notify";
import {
  ANSWERED_STATES,
  FIGURE_KEYS,
  FIGURES_ROLES,
  KIND_LABEL,
  NOT_ISSUED,
  dayText,
  figuresByBranch,
  givesFigures,
  istAt,
  istClock,
  istDay,
  journalIssued,
  journalPhase,
  nextDay,
  parseFigures,
  prefillFigures,
  previousDay,
  type CountedFigures,
  type DayEndFigures,
  type FigureKey,
  type JournalClock,
  type JournalPhase,
  type JournalStanding,
  type MonthPerson,
} from "@/lib/journal";
import { monthDays } from "@/lib/month";

/*
 * The day end report, called the journal throughout the code: what each
 * person did in the portal on one working day, read from the records
 * themselves, issued at the end of the day for them to view and verify, the
 * way a bank teller signs the batch journal at close. A counsellor also types
 * the day's figures (leads, calls, follow-ups, registrations) when answering.
 *
 * Medcity's own people only: the Overseas desk and the Medcity branches. A
 * sub-agent firm's staff are not Medcity's to supervise, the super admin owns
 * the platform rather than working files on it, and management reads and
 * changes nothing, so none of them is issued one.
 *
 * Nothing here depends on the scheduler having run. A journal is read live
 * until it is answered; a day past its cutoff counts as closed whenever it is
 * next looked at; and announcing the day and sending the report are each done
 * once, by whichever of the scheduler, the last answer or the next page view
 * gets there first.
 */

const {
  users: us,
  organizations: og,
  students: s,
  applications: a,
  statusHistory: sh,
  statusDefinitions: sd,
  documents: dc,
  documentTypes: dt,
  checklistItems: ci,
  checklistFiles: cf,
  contactLog: cl,
  tasks: tk,
  comments: cm,
  enquiries: en,
  enquiryNotes: enn,
  invoicePayments: ip,
  vendorInvoices: vi,
  auditLogs: al,
  signInEvents: se,
  dailyJournals: dj,
  journalDays: jd,
  programs: pr,
} = schema;

export type JournalEntry = { at: string; kind: string; text: string; href?: string | null; outOfHours?: boolean };

/** Who is sent the consolidated report. Management reads it, and is not sent it. */
const REPORT_TO = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN"] as const;

export const journalClock = cache(async (): Promise<JournalClock> => {
  const st = await getSettings();
  return { dayEnd: st.journalDayEnd, outOfHours: st.journalOutOfHours, cutoff: st.journalCutoff, onSundays: st.journalOnSundays };
});

/** Everybody issued a journal. */
export async function journalStaff() {
  return db
    .select({ id: us.id, name: us.name, role: us.role, deskLabel: us.deskLabel, orgId: og.id, branch: og.name, orgType: og.type })
    .from(us)
    .innerJoin(og, eq(us.orgId, og.id))
    .where(and(eq(us.active, true), inArray(og.type, ["HQ", "BRANCH"]), notInArray(us.role, [...NOT_ISSUED])))
    .orderBy(asc(og.type), asc(og.name), asc(us.name));
}

export async function issuedTo(user: Pick<SessionUser, "id" | "role" | "orgId">) {
  const org = await db.query.organizations.findFirst({ where: eq(og.id, user.orgId), columns: { type: true } });
  return journalIssued(user.role, org?.type ?? "");
}

/** Things that are already a line of their own, so the audit log does not say them twice. */
const COVERED = [
  "student.create",
  "application.create",
  "application.status",
  "status.update",
  "document.upload",
  // A replacement is a new row on the documents table, so it is already a line.
  "document.replace",
  "checklist.accept",
  "checklist.reject",
  "checklist.request",
  "contact.log",
  "task.create",
  "task.done",
  "task.done_many",
  "enquiry.create",
  "invoice.payment",
  "cron.ran",
  // Reading is not doing: opening, claiming and downloading are left out so
  // the journal is the day's work rather than the day's clicks.
  "checklist.claim",
  "checklist.sync",
  "document.download",
  "resource.download",
  "pack.download",
  "passport.reveal",
];

/** "student.reassign" said as a person would say it. */
const SAYS: Record<string, string> = {
  "student.reassign": "Gave a student to somebody else",
  "student.profile.update": "Updated a student's profile",
  "student.handover": "Handed a file to the Overseas desk",
  "student.stage": "Moved a student to another stage",
  "student.delete": "Deleted a student",
  "student.unarchive": "Brought a student back from the archive",
  "application.handover": "Handed an application over",
  "application.returned": "Sent an application back to the branch",
  "application.officer": "Changed the officer on an application",
  "application.priority": "Changed an application's priority",
  "application.fee_paid": "Marked a fee as paid",
  "application.offer_visa": "Recorded an offer or visa detail",
  "application.submitted_to_vendor": "Submitted an application to the institution",
  "application.deadline": "Set an application deadline",
  "application.deadline_done": "Marked a deadline done",
  "checklist.chase": "Chased a student for documents",
  "document.remove": "Removed a document from a student's file",
  "document.restore": "Brought back an earlier version of a document",
  "document.unremove": "Put a removed document back",
  "checklist.not_needed": "Marked a document not needed",
  "checklist.add": "Added a document to a student's list",
  "checklist.reassign": "Gave a document check to somebody else",
  "enquiry.update": "Updated an enquiry",
  "enquiry.follow_up": "Set an enquiry follow-up",
  "enquiry.convert": "Turned an enquiry into a student",
  "enquiry.stage": "Moved an enquiry",
  "enquiry.assign": "Gave an enquiry to somebody",
  "task.update": "Changed a follow-up",
  "task.push": "Moved a follow-up to another day",
  "task.delete": "Deleted a follow-up",
  "invoice.raise": "Raised an invoice",
  "invoice.sent": "Sent an invoice",
  "invoice.credit_note": "Issued a credit note",
  "income.received": "Recorded money received",
  "income.create": "Added an income line",
  "income.update": "Updated an income line",
  "commission.status": "Moved a commission",
  "payout.decide": "Decided a payout",
  "ausbildung.save": "Updated an Ausbildung record",
  "german.module": "Updated a German level",
  "nclex.step": "Recorded an NCLEX-RN step",
  "nclex.result": "Recorded an NCLEX-RN result",
  "user.password_change": "Changed their password",
  "dashboard.export": "Downloaded a dashboard as Excel",
  "journal.export": "Downloaded a month of day end figures as Excel",
};
const say = (action: string) => SAYS[action] ?? action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const studentName = sql<string>`${s.firstName} || ' ' || ${s.lastName}`;

/**
 * Everything the given people did on one working day, each person's lines
 * oldest first. One query per kind of record for everybody together, so the
 * consolidated report costs the same as one journal.
 */
export async function dayEntries(day: string, userIds: string[]): Promise<Map<string, JournalEntry[]>> {
  const out = new Map<string, JournalEntry[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;
  const clock = await journalClock();
  const from = istAt(day, "00:00");
  const to = istAt(nextDay(day), "00:00");
  const late = istAt(day, clock.outOfHours);
  const within = (col: Parameters<typeof gte>[0]) => and(gte(col, from), lt(col, to));
  const ids = userIds;

  const [signins, registered, applied, moved, uploaded, checked, asked, contacts, done, set, messages, enquiries, enquiryNotes, payments, other] = await Promise.all([
    db
      .select({ who: se.userId, at: se.createdAt })
      .from(se)
      .where(and(inArray(se.userId, ids), eq(se.outcome, "success"), within(se.createdAt))),
    db
      .select({ who: s.createdById, at: s.createdAt, id: s.id, name: studentName })
      .from(s)
      .where(and(inArray(s.createdById, ids), within(s.createdAt))),
    db
      .select({ who: a.createdById, at: a.createdAt, id: a.id, studentId: s.id, name: studentName, program: pr.name })
      .from(a)
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(pr, eq(a.programId, pr.id))
      .where(and(inArray(a.createdById, ids), within(a.createdAt))),
    db
      .select({ who: sh.changedById, at: sh.createdAt, appId: a.id, studentId: s.id, name: studentName, status: sd.label })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      // The status an application is created in is part of making it, which
      // is already a line of its own.
      .where(and(inArray(sh.changedById, ids), within(sh.createdAt), isNotNull(sh.fromStatusId))),
    db
      .select({ who: dc.uploadedById, at: dc.createdAt, studentId: s.id, name: studentName, what: sql<string>`coalesce(${dc.label}, ${dt.label}, ${dc.fileName})` })
      .from(dc)
      .innerJoin(s, eq(dc.studentId, s.id))
      .leftJoin(dt, eq(dc.typeCode, dt.code))
      .where(and(inArray(dc.uploadedById, ids), within(dc.createdAt))),
    db
      .select({ who: cf.decidedById, at: cf.decidedAt, outcome: cf.outcome, studentId: s.id, name: studentName, what: dt.label })
      .from(cf)
      .innerJoin(ci, eq(cf.itemId, ci.id))
      .innerJoin(s, eq(ci.studentId, s.id))
      .innerJoin(dt, eq(ci.typeCode, dt.code))
      .where(and(inArray(cf.decidedById, ids), within(cf.decidedAt))),
    db
      .select({ who: ci.askedById, at: ci.askedAt, studentId: s.id, name: studentName, what: dt.label })
      .from(ci)
      .innerJoin(s, eq(ci.studentId, s.id))
      .innerJoin(dt, eq(ci.typeCode, dt.code))
      .where(and(inArray(ci.askedById, ids), within(ci.askedAt))),
    db
      .select({ who: cl.byId, at: cl.createdAt, channel: cl.channel, outcome: cl.outcome, studentId: s.id, name: studentName })
      .from(cl)
      .innerJoin(s, eq(cl.studentId, s.id))
      .where(and(inArray(cl.byId, ids), within(cl.createdAt))),
    db
      .select({ who: tk.doneById, at: tk.doneAt, title: tk.title, studentId: tk.studentId, name: sql<string | null>`${s.firstName} || ' ' || ${s.lastName}` })
      .from(tk)
      .leftJoin(s, eq(tk.studentId, s.id))
      .where(and(inArray(tk.doneById, ids), within(tk.doneAt))),
    db
      .select({ who: tk.createdById, at: tk.createdAt, title: tk.title, due: tk.dueOn, studentId: tk.studentId, name: sql<string | null>`${s.firstName} || ' ' || ${s.lastName}` })
      .from(tk)
      .leftJoin(s, eq(tk.studentId, s.id))
      .where(and(inArray(tk.createdById, ids), within(tk.createdAt))),
    db
      .select({ who: cm.authorId, at: cm.createdAt, channel: cm.channel, appId: a.id, studentId: s.id, name: studentName })
      .from(cm)
      .innerJoin(a, eq(cm.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .where(and(inArray(cm.authorId, ids), within(cm.createdAt))),
    db
      .select({ who: en.createdById, at: en.createdAt, id: en.id, name: en.name })
      .from(en)
      .where(and(inArray(en.createdById, ids), within(en.createdAt))),
    db
      .select({ who: enn.authorId, at: enn.createdAt, id: en.id, name: en.name })
      .from(enn)
      .innerJoin(en, eq(enn.enquiryId, en.id))
      .where(and(inArray(enn.authorId, ids), within(enn.createdAt))),
    db
      .select({ who: ip.recordedById, at: ip.createdAt, amount: ip.amount, currency: ip.currency, invoiceId: vi.id, number: vi.number })
      .from(ip)
      .innerJoin(vi, eq(ip.invoiceId, vi.id))
      .where(and(inArray(ip.recordedById, ids), within(ip.createdAt))),
    db
      .select({ who: al.actorId, at: al.createdAt, action: al.action, entityType: al.entityType, entityId: al.entityId })
      .from(al)
      .where(and(inArray(al.actorId, ids), within(al.createdAt), notInArray(al.action, COVERED))),
  ]);

  const put = (who: string | null, at: Date | null, kind: string, text: string, href?: string | null) => {
    if (!who || !at) return;
    out.get(who)?.push({ at: at.toISOString(), kind, text, href: href ?? null, outOfHours: at >= late });
  };
  const studentHref = (id: string | null) => (id ? `/students/${id}` : null);

  for (const r of signins) put(r.who, r.at, "signin", "Signed in");
  for (const r of registered) put(r.who, r.at, "student", `Registered ${r.name}`, `/students/${r.id}/profile`);
  for (const r of applied) put(r.who, r.at, "application", `Made an application for ${r.name}: ${r.program}`, `/students/${r.studentId}/applications?app=${r.id}`);
  for (const r of moved) put(r.who, r.at, "status", `${r.name}: moved to ${r.status}`, `/students/${r.studentId}/applications?app=${r.appId}`);
  for (const r of uploaded) put(r.who, r.at, "upload", `Uploaded ${r.what} for ${r.name}`, `/students/${r.studentId}/documentation`);
  for (const r of checked)
    put(r.who, r.at, "check", `${r.outcome === "REJECTED" ? "Sent back" : r.outcome === "ACCEPTED" ? "Accepted" : "Checked"} ${r.what} for ${r.name}`, `/students/${r.studentId}/documentation`);
  for (const r of asked) put(r.who, r.at, "ask", `Asked ${r.name} for ${r.what}`, `/students/${r.studentId}/documentation`);
  for (const r of contacts)
    put(r.who, r.at, "contact", `${r.channel === "CALL" ? "Call" : r.channel === "WHATSAPP" ? "WhatsApp" : r.channel === "VISIT" ? "Visit" : r.channel === "EMAIL" ? "Email" : "SMS"} with ${r.name}: ${r.outcome.toLowerCase().replace(/_/g, " ")}`, studentHref(r.studentId));
  for (const r of done) put(r.who, r.at, "followup_done", `Follow-up done: ${r.title}${r.name ? ` (${r.name})` : ""}`, studentHref(r.studentId));
  for (const r of set) put(r.who, r.at, "followup_set", `Follow-up set for ${dayText(r.due)}: ${r.title}${r.name ? ` (${r.name})` : ""}`, studentHref(r.studentId));
  for (const r of messages) put(r.who, r.at, "message", r.channel === "STUDENT" ? `Wrote to ${r.name}` : `Team note on ${r.name}'s application`, `/students/${r.studentId}/applications?app=${r.appId}`);
  for (const r of enquiries) put(r.who, r.at, "enquiry", `Added the enquiry ${r.name}`, `/enquiries/${r.id}`);
  for (const r of enquiryNotes) put(r.who, r.at, "enquiry", `Note on the enquiry ${r.name}`, `/enquiries/${r.id}`);
  for (const r of payments) put(r.who, r.at, "payment", `Recorded ${r.currency} ${r.amount.toLocaleString("en-IN")} against ${r.number}`, `/admin/invoices/${r.invoiceId}`);
  for (const r of other) put(r.who, r.at, "other", say(r.action), r.entityType === "student" ? studentHref(r.entityId) : null);

  for (const list of out.values()) list.sort((x, y) => x.at.localeCompare(y.at));
  return out;
}

/** What each kind of line adds up to, for the totals at the top of a journal. */
export function kindCounts(entries: JournalEntry[]) {
  const by = new Map<string, number>();
  for (const e of entries) by.set(e.kind, (by.get(e.kind) ?? 0) + 1);
  return by;
}

/**
 * What the portal can count towards somebody's day end figures: calls they
 * logged (the call channel only; a WhatsApp or a visit is not a call),
 * follow-ups they marked done and students they registered, on the day. One
 * query per figure for everybody asked for together.
 */
export async function countedFigures(day: string, userIds: string[]): Promise<Map<string, CountedFigures>> {
  const out = new Map<string, CountedFigures>(userIds.map((id) => [id, {}]));
  if (userIds.length === 0) return out;
  const from = istAt(day, "00:00");
  const to = istAt(nextDay(day), "00:00");
  const within = (col: Parameters<typeof gte>[0]) => and(gte(col, from), lt(col, to));
  const count = sql<number>`count(*)::int`;
  const [calls, done, registered] = await Promise.all([
    db
      .select({ who: cl.byId, n: count })
      .from(cl)
      .where(and(inArray(cl.byId, userIds), eq(cl.channel, "CALL"), within(cl.createdAt)))
      .groupBy(cl.byId),
    db
      .select({ who: tk.doneById, n: count })
      .from(tk)
      .where(and(inArray(tk.doneById, userIds), within(tk.doneAt)))
      .groupBy(tk.doneById),
    db
      .select({ who: s.createdById, n: count })
      .from(s)
      .where(and(inArray(s.createdById, userIds), within(s.createdAt)))
      .groupBy(s.createdById),
  ]);
  const put = (who: string | null, key: keyof CountedFigures, n: number) => {
    const f = who ? out.get(who) : undefined;
    if (f) f[key] = n;
  };
  for (const r of calls) put(r.who, "callsMade", r.n);
  for (const r of done) put(r.who, "followUpsDone", r.n);
  for (const r of registered) put(r.who, "registrationsDone", r.n);
  return out;
}

/** The boxes as they open for one person on one day, or null for a role not asked. */
async function prefillFor(userId: string, role: string, day: string): Promise<DayEndFigures | null> {
  if (!givesFigures(role)) return null;
  return prefillFigures((await countedFigures(day, [userId])).get(userId) ?? {});
}

/** How one answered journal reads, given the clock. */
function standing(row: { state: string | null; decidedAt: Date | null } | undefined, phase: JournalPhase, late: Date): JournalStanding {
  if (row?.state === "FLAGGED") return "FLAGGED";
  if (row?.state === "VERIFIED") return row.decidedAt && row.decidedAt >= late ? "VERIFIED_LATE" : "VERIFIED";
  if (row?.state === "MISSED") return "MISSED";
  return phase === "CLOSED" ? "MISSED" : "PENDING";
}

/**
 * One person's journal for one day, with where the day stands. The figures
 * are what they typed once answered; until then, for a counselling role, the
 * boxes as they would open, with the portal's own counts filled in.
 */
export async function journalFor(userId: string, role: string, day: string, now: Date = new Date()) {
  const clock = await journalClock();
  const phase = journalPhase(day, clock, now);
  const row = await db.query.dailyJournals.findFirst({ where: and(eq(dj.userId, userId), eq(dj.day, day)) });
  // Once answered, the journal is what they saw when they answered.
  const answered = !!row?.state;
  const [entries, prefill] = await Promise.all([
    answered && row?.entries ? Promise.resolve(row.entries) : dayEntries(day, [userId]).then((m) => m.get(userId) ?? []),
    // The boxes are only ever shown while the day is open to answer.
    answered || phase !== "OPEN" ? Promise.resolve(null) : prefillFor(userId, role, day),
  ]);
  return {
    day,
    phase,
    clock,
    row: row ?? null,
    entries,
    standing: standing(row, phase, istAt(day, clock.outOfHours)),
    figures: answered ? (row?.figures ?? null) : null,
    prefill,
  };
}

/** Noted the first time somebody opens their journal once it is issued. */
export async function markViewed(userId: string, day: string) {
  await db
    .insert(dj)
    .values({ userId, day, viewedAt: new Date() })
    .onConflictDoUpdate({ target: [dj.userId, dj.day], set: { viewedAt: sql`coalesce(${dj.viewedAt}, now())` } });
}

/**
 * Somebody answers their journal: verified, or flagged with what is wrong.
 * Only their own, only today's, only while it is open, and only once. When
 * the last person answers, the consolidated report goes at once rather than
 * waiting for the cutoff.
 *
 * A counselling role also hands in the five day end figures, as typed; every
 * one has to be a whole number before either answer is accepted, and they are
 * kept with the answer whether it verified or flagged. Other roles are not
 * asked, and whatever they send is ignored.
 */
export async function answerJournal(user: SessionUser, verdict: "VERIFIED" | "FLAGGED", note: string | null, typed: Partial<Record<FigureKey, string | null>> | null = null, now: Date = new Date()) {
  const day = istDay(now);
  const clock = await journalClock();
  const phase = journalPhase(day, clock, now);
  if (!(await issuedTo(user))) return { ok: false as const, error: "There is no day end report for your role." };
  if (phase === "BEFORE") return { ok: false as const, error: `Your day end report opens at the end of the day.` };
  if (phase !== "OPEN") return { ok: false as const, error: "Today's day end report has closed." };
  if (verdict === "FLAGGED" && !note?.trim()) return { ok: false as const, error: "Say what is wrong, so it can be looked into." };
  let figures: DayEndFigures | null = null;
  if (givesFigures(user.role)) {
    const parsed = parseFigures(typed ?? {});
    if (!parsed.ok) return { ok: false as const, error: "Fill in the day's figures: a whole number in every box, 0 if none.", fieldErrors: parsed.fieldErrors as Record<string, string[]> };
    figures = parsed.figures;
  }
  const entries = (await dayEntries(day, [user.id])).get(user.id) ?? [];
  const [saved] = await db
    .insert(dj)
    .values({ userId: user.id, day, viewedAt: now, state: verdict, decidedAt: now, note: verdict === "FLAGGED" ? note!.trim() : null, entries, figures })
    .onConflictDoUpdate({
      target: [dj.userId, dj.day],
      set: { state: verdict, decidedAt: now, note: verdict === "FLAGGED" ? note!.trim() : null, entries, figures, viewedAt: sql`coalesce(${dj.viewedAt}, now())` },
      // Answered once. A second press, or a second tab, changes nothing.
      setWhere: isNull(dj.state),
    })
    .returning({ id: dj.id });
  if (!saved) return { ok: false as const, error: "You have already answered today's day end report." };
  const waiting = await stillWaiting(day);
  if (waiting === 0) await sendReport(day, "ALL_DONE");
  return { ok: true as const };
}

/** How many of today's staff have not answered yet. */
async function stillWaiting(day: string) {
  const staff = await journalStaff();
  if (staff.length === 0) return 0;
  const answered = await db
    .select({ id: dj.userId })
    .from(dj)
    .where(and(eq(dj.day, day), isNotNull(dj.state), inArray(dj.userId, staff.map((x) => x.id))));
  return staff.length - answered.length;
}

/** The consolidated report for one day: every person, how they answered, and when they were signed in after hours. */
export async function consolidated(day: string, now: Date = new Date()) {
  const clock = await journalClock();
  const phase = journalPhase(day, clock, now);
  const staff = await journalStaff();
  const ids = staff.map((x) => x.id);
  const [rows, entries, dayRow] = await Promise.all([
    ids.length ? db.select().from(dj).where(and(eq(dj.day, day), inArray(dj.userId, ids))) : Promise.resolve([]),
    dayEntries(day, ids),
    db.query.journalDays.findFirst({ where: eq(jd.day, day) }),
  ]);
  const late = istAt(day, clock.outOfHours);
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const people = staff.map((p) => {
    const row = byUser.get(p.id);
    const list = row?.state && row.entries ? row.entries : (entries.get(p.id) ?? []);
    const live = entries.get(p.id) ?? [];
    return {
      ...p,
      standing: standing(row, phase, late),
      viewedAt: row?.viewedAt ?? null,
      decidedAt: row?.decidedAt ?? null,
      note: row?.note ?? null,
      // The figures are only ever typed by the person answering, so a report
      // written as missed has none, and an older answer from before the
      // figures were asked for has none either.
      figures: row?.state === "VERIFIED" || row?.state === "FLAGGED" ? (row.figures ?? null) : null,
      actions: list.filter((e) => e.kind !== "signin").length,
      // Sign-ins after hours are read live, so one after the answer still shows.
      lateSignIns: live.filter((e) => e.kind === "signin" && e.outOfHours).map((e) => e.at),
      lateActions: live.filter((e) => e.kind !== "signin" && e.outOfHours).length,
    };
  });
  // Grouped by branch before the sort below reorders people by standing.
  const figures = figuresByBranch(people);
  const order: Record<JournalStanding, number> = { MISSED: 0, FLAGGED: 1, PENDING: 2, VERIFIED_LATE: 3, VERIFIED: 4 };
  people.sort((x, y) => order[x.standing] - order[y.standing] || y.lateSignIns.length - x.lateSignIns.length || x.name.localeCompare(y.name));
  const count = (st: JournalStanding) => people.filter((p) => p.standing === st).length;
  return {
    day,
    phase,
    clock,
    people,
    figures,
    sentAt: dayRow?.reportSentAt ?? null,
    reason: dayRow?.reportReason ?? null,
    totals: {
      staff: people.length,
      verified: count("VERIFIED"),
      verifiedLate: count("VERIFIED_LATE"),
      flagged: count("FLAGGED"),
      pending: count("PENDING"),
      missed: count("MISSED"),
      outOfHours: people.filter((p) => p.lateSignIns.length > 0).length,
    },
  };
}

/* ---------------- A month of figures ---------------- */

/** The branches whose people are issued day end reports: the head office and the Medcity branches. */
export async function journalBranches() {
  return db
    .select({ id: og.id, name: og.name, type: og.type })
    .from(og)
    .where(and(inArray(og.type, ["HQ", "BRANCH"]), eq(og.active, true)))
    .orderBy(asc(og.type), asc(og.name));
}

/**
 * Every counsellor's month in one row each: the five figures added up over the
 * reports they answered (verified or flagged; a missed day carries none), the
 * days answered and the days missed. The adding up is done in the database,
 * grouped by person, so a month of reports is one query, not a row per day.
 *
 * Who is listed: the roles that give figures, at the head office and the
 * branches, in the branches asked for (every branch when none is named).
 * Somebody who has since left the branch stays on the list for a month they
 * answered in, because their figures are in the branch's total.
 *
 * A day is missed when the cutoff wrote it as missed, which is how a day
 * closes. A day with no row at all (before somebody joined, a Sunday, a day
 * still open) is neither answered nor missed.
 */
export async function monthFigures(month: string, orgIds: string[] | null): Promise<MonthPerson[]> {
  if (orgIds && orgIds.length === 0) return [];
  const { first, next } = monthDays(month);
  const answered = sql`${dj.state} in (${sql.join(ANSWERED_STATES.map((st) => sql`${st}`), sql`, `)})`;
  // The key is one of the five constants, written into the SQL as a literal so
  // Postgres reads it as the text form of ->> without being asked to guess.
  const summed = (key: FigureKey) => sql<number>`coalesce(sum((${dj.figures}->>${sql.raw(`'${key}'`)})::int) filter (where ${answered}), 0)::int`;
  const agg = db
    .select({
      userId: dj.userId,
      answered: sql<number>`(count(*) filter (where ${answered}))::int`.as("answered"),
      missed: sql<number>`(count(*) filter (where ${dj.state} = 'MISSED'))::int`.as("missed"),
      leadsReceived: summed("leadsReceived").as("leads_received"),
      callsMade: summed("callsMade").as("calls_made"),
      connectedCalls: summed("connectedCalls").as("connected_calls"),
      followUpsDone: summed("followUpsDone").as("follow_ups_done"),
      registrationsDone: summed("registrationsDone").as("registrations_done"),
    })
    .from(dj)
    .where(and(gte(dj.day, first), lt(dj.day, next)))
    .groupBy(dj.userId)
    .as("agg");
  const rows = await db
    .select({
      id: us.id,
      name: us.name,
      role: us.role,
      orgId: og.id,
      branch: og.name,
      answered: sql<number>`coalesce(${agg.answered}, 0)::int`,
      missed: sql<number>`coalesce(${agg.missed}, 0)::int`,
      leadsReceived: sql<number>`coalesce(${agg.leadsReceived}, 0)::int`,
      callsMade: sql<number>`coalesce(${agg.callsMade}, 0)::int`,
      connectedCalls: sql<number>`coalesce(${agg.connectedCalls}, 0)::int`,
      followUpsDone: sql<number>`coalesce(${agg.followUpsDone}, 0)::int`,
      registrationsDone: sql<number>`coalesce(${agg.registrationsDone}, 0)::int`,
    })
    .from(us)
    .innerJoin(og, eq(us.orgId, og.id))
    .leftJoin(agg, eq(agg.userId, us.id))
    .where(
      and(
        inArray(us.role, [...FIGURES_ROLES]),
        inArray(og.type, ["HQ", "BRANCH"]),
        orgIds ? inArray(og.id, orgIds) : undefined,
        or(eq(us.active, true), isNotNull(agg.userId)),
      ),
    )
    .orderBy(asc(og.type), asc(og.name), asc(us.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    orgId: r.orgId,
    branch: r.branch,
    answered: Number(r.answered),
    missed: Number(r.missed),
    figures: Object.fromEntries(FIGURE_KEYS.map((k) => [k, Number(r[k])])) as Record<(typeof FIGURE_KEYS)[number], number>,
  }));
}

/** One person's month, day by day: what they gave and how the day stands. Only the days that have a report row. */
export async function monthDayList(userId: string, month: string) {
  const clock = await journalClock();
  const now = new Date();
  const { first, next } = monthDays(month);
  const rows = await db
    .select({ day: dj.day, state: dj.state, decidedAt: dj.decidedAt, note: dj.note, figures: dj.figures })
    .from(dj)
    .where(and(eq(dj.userId, userId), gte(dj.day, first), lt(dj.day, next)))
    .orderBy(asc(dj.day));
  return rows.map((r) => ({
    day: r.day,
    standing: standing(r, journalPhase(r.day, clock, now), istAt(r.day, clock.outOfHours)),
    decidedAt: r.decidedAt,
    note: r.note,
    // The figures count only once the day was answered; a day written as missed has none to show.
    figures: r.state && (ANSWERED_STATES as readonly string[]).includes(r.state) ? (r.figures ?? null) : null,
  }));
}

/** Make sure the day has its row, so the two "once only" stamps have somewhere to go. */
async function dayRow(day: string) {
  await db.insert(jd).values({ day }).onConflictDoNothing();
}

/** Tell everybody issued a day end report that today's is ready. Once a day. */
export async function issueDay(day: string) {
  await dayRow(day);
  const [won] = await db.update(jd).set({ issuedAt: new Date() }).where(and(eq(jd.day, day), isNull(jd.issuedAt))).returning({ day: jd.day });
  if (!won) return false;
  const clock = await journalClock();
  const staff = await journalStaff();
  await notifyUsers(
    staff.map((x) => x.id),
    "Your day end report for today is ready",
    `View and verify what you did today before you leave. It closes at ${istClock(istAt(day, clock.cutoff))}.`,
    "/journal",
  );
  return true;
}

/**
 * Close a day: anybody who has not answered is written down as missed, with
 * the journal they would have seen, and the report goes to the Overseas
 * admin. Once a day, however many times it is asked for.
 */
export async function sendReport(day: string, reason: "ALL_DONE" | "CUTOFF") {
  await dayRow(day);
  const [won] = await db
    .update(jd)
    .set({ reportSentAt: new Date(), reportReason: reason })
    .where(and(eq(jd.day, day), isNull(jd.reportSentAt)))
    .returning({ day: jd.day });
  if (!won) return false;
  if (reason === "CUTOFF") {
    const staff = await journalStaff();
    const answered = new Set(
      (await db.select({ id: dj.userId }).from(dj).where(and(eq(dj.day, day), isNotNull(dj.state)))).map((r) => r.id),
    );
    const missing = staff.filter((p) => !answered.has(p.id)).map((p) => p.id);
    if (missing.length) {
      const entries = await dayEntries(day, missing);
      for (const id of missing) {
        await db
          .insert(dj)
          .values({ userId: id, day, state: "MISSED", entries: entries.get(id) ?? [] })
          .onConflictDoUpdate({ target: [dj.userId, dj.day], set: { state: "MISSED", entries: entries.get(id) ?? [] }, setWhere: isNull(dj.state) });
      }
    }
  }
  const report = await consolidated(day);
  const t = report.totals;
  const bits = [
    `${t.verified + t.verifiedLate} verified`,
    t.flagged ? `${t.flagged} flagged` : null,
    t.missed ? `${t.missed} missed` : null,
    t.outOfHours ? `${t.outOfHours} signed in after hours` : null,
  ].filter(Boolean);
  const recipients = await db
    .select({ id: us.id })
    .from(us)
    .where(and(eq(us.active, true), inArray(us.role, [...REPORT_TO])));
  await notifyUsers(
    recipients.map((r) => r.id),
    reason === "ALL_DONE" ? `Every day end report for today is verified` : `Day end reports: ${bits.join(", ")}`,
    reason === "ALL_DONE" ? `All ${t.staff} people answered before the cutoff. ${bits.join(", ")}.` : `The cutoff has passed. ${bits.join(", ")}.`,
    `/journal/report?day=${day}`,
  );
  return true;
}

/**
 * Bring the journals up to date with the clock: announce today once the day
 * has ended, and close any working day in the last week whose cutoff has
 * passed. Called by the scheduler, and on the way past by the screens, so a
 * scheduler nobody set up only delays the notifications, never the answers.
 */
export async function catchUp(now: Date = new Date()) {
  const clock = await journalClock();
  const today = istDay(now);
  const done = { issued: false, closed: [] as string[] };
  const phase = journalPhase(today, clock, now);
  // Today has a row from the first time this runs, which is also how the
  // portal knows when journals began: a day before that was never issued, and
  // nobody is marked as having missed a journal they were never given.
  await dayRow(today);
  const [first] = await db.select({ day: sql<string>`min(${jd.day})::text` }).from(jd);
  const began = first?.day ?? today;
  if (phase === "OPEN") done.issued = await issueDay(today);
  let day = today;
  for (let i = 0; i < 7 && day >= began; i++) {
    if (journalPhase(day, clock, now) === "CLOSED") {
      const row = await db.query.journalDays.findFirst({ where: eq(jd.day, day), columns: { reportSentAt: true } });
      if (!row?.reportSentAt && (await sendReport(day, "CUTOFF"))) done.closed.push(day);
    }
    day = previousDay(day);
  }
  return done;
}

/**
 * Whether to put the day end report in front of somebody right now: their
 * own, today's, open, and not yet answered. Cheap enough to ask on every page.
 */
export const journalWaiting = cache(async (user: SessionUser) => {
  const clock = await journalClock();
  const now = new Date();
  const day = istDay(now);
  if (journalPhase(day, clock, now) !== "OPEN") return null;
  if (!(await issuedTo(user))) return null;
  const row = await db.query.dailyJournals.findFirst({ where: and(eq(dj.userId, user.id), eq(dj.day, day)), columns: { state: true } });
  if (row?.state) return null;
  // Enough of the day to answer it from the popup: the totals, the latest
  // few lines, whether a sign-in has already gone past hours, and the figure
  // boxes as they open for a counsellor.
  const [entries, figures] = await Promise.all([dayEntries(day, [user.id]).then((m) => m.get(user.id) ?? []), prefillFor(user.id, user.role, day)]);
  const work = entries.filter((e) => e.kind !== "signin");
  const totals = [...kindCounts(work)].map(([kind, n]) => ({ label: KIND_LABEL[kind] ?? kind, n }));
  return {
    day,
    closesAt: istClock(istAt(day, clock.cutoff)),
    work: work.length,
    totals,
    latest: work
      .slice(-5)
      .reverse()
      .map((e) => ({ at: istClock(e.at), text: e.text, href: e.href ?? null, outOfHours: !!e.outOfHours })),
    lateSignIn: entries.some((e) => e.kind === "signin" && e.outOfHours),
    figures,
  };
});

/** Somebody's last two weeks of day end reports, for the history under today's. */
export async function journalHistory(userId: string, days = 14) {
  const clock = await journalClock();
  const now = new Date();
  const rows = await db
    .select({ day: dj.day, state: dj.state, decidedAt: dj.decidedAt, note: dj.note })
    .from(dj)
    .where(and(eq(dj.userId, userId), gte(dj.day, istDay(new Date(now.getTime() - days * 86_400_000)))))
    .orderBy(sql`${dj.day} desc`);
  return rows.map((r) => ({ ...r, standing: standing(r, journalPhase(r.day, clock, now), istAt(r.day, clock.outOfHours)) }));
}

/**
 * catchUp, from the app shell, at most once every five minutes per server, so
 * a page view is never slowed by it more than that. Failure is swallowed: a
 * journal notification arriving late is not worth a broken page.
 */
let lastTick = 0;
export async function journalTick() {
  const now = Date.now();
  if (now - lastTick < 5 * 60_000) return;
  lastTick = now;
  try {
    await catchUp(new Date(now));
  } catch {
    lastTick = 0;
  }
}
