import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { COUNSELLING_ROLES } from "@/lib/permissions";
import { getSlaDays } from "./dashboard";
import { lensApps, lensOrg, lensStudents, type Lens } from "./dashboard-lens";

const {
  applications: a,
  statusDefinitions: sd,
  students: s,
  users: us,
  organizations: og,
  programs: pr,
  universities: un,
  countries: co,
  checklistItems: ci,
  documentTypes: dt,
  applicationDeadlines: dl,
  tasks: tk,
  statusHistory: sh,
} = schema;

/*
 * The work behind the role dashboards: what is on the board stage by stage,
 * what is late, what falls due this week, who is carrying what, and which
 * students still owe documents. Every query reads the same lens as the
 * figures, so a counsellor's board only ever holds their own students and a
 * branch's only its own.
 */

const name = sql<string>`${s.firstName} || ' ' || ${s.lastName}`;
const daysSince = (col: SQL | typeof a.statusChangedAt) => sql<number>`floor(extract(epoch from (now() - ${col})) / 86400)::int`;

/** The live stages, in the order the work moves, for the pipeline board. */
export const PIPELINE = [
  { key: "NEW", label: "New", groups: ["NEW"] },
  { key: "PENDING_PARTNER", label: "Waiting on partner", groups: ["PENDING_PARTNER"] },
  { key: "IN_PROGRESS", label: "In progress", groups: ["IN_PROGRESS"] },
  { key: "OFFER", label: "Offer", groups: ["OFFER"] },
  { key: "SUCCESS", label: "Visa or enrolled", groups: ["SUCCESS"] },
] as const;

export type PipelineCard = {
  id: string;
  studentId: string;
  student: string;
  program: string;
  university: string;
  country: string | null;
  branch: string;
  days: number;
  late: boolean;
};

/**
 * Every live application as a card in its stage, the one waiting longest at
 * the top. A column shows a handful and says how many it holds; the full list
 * is a link away, because a board of two hundred cards is not read.
 */
export async function pipeline(lens: Lens, perColumn = 4) {
  const sla = await getSlaDays();
  const groups = PIPELINE.flatMap((p) => [...p.groups]);
  const [counts, cards] = await Promise.all([
    db
      .select({ group: sd.group, n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(lensApps(lens), inArray(sd.group, groups)))
      .groupBy(sd.group),
    db
      .select({
        id: a.id,
        studentId: s.id,
        student: name,
        program: pr.name,
        university: un.name,
        country: co.name,
        branch: og.name,
        group: sd.group,
        days: daysSince(a.statusChangedAt),
        rank: sql<number>`row_number() over (partition by ${sd.group} order by ${a.statusChangedAt} asc)`.mapWith(Number),
      })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(pr, eq(a.programId, pr.id))
      .innerJoin(un, eq(pr.universityId, un.id))
      .leftJoin(co, eq(un.countryId, co.id))
      .innerJoin(og, eq(a.orgId, og.id))
      .where(and(lensApps(lens), inArray(sd.group, groups))),
  ]);
  const n = new Map(counts.map((c) => [c.group as string, Number(c.n)]));
  return PIPELINE.map((p) => ({
    key: p.key,
    label: p.label,
    total: p.groups.reduce((sum, g) => sum + (n.get(g) ?? 0), 0),
    href: `/applications?group=${p.key}${lens.person ? `&assignedTo=${lens.person.id}` : ""}`,
    cards: cards
      .filter((c) => (p.groups as readonly string[]).includes(c.group) && c.rank <= perColumn)
      .sort((x, y) => y.days - x.days)
      .map(
        (c): PipelineCard => ({
          id: c.id,
          studentId: c.studentId,
          student: c.student,
          program: c.program,
          university: c.university,
          country: c.country,
          branch: c.branch,
          days: Number(c.days),
          late: Number(c.days) > (sla[c.group] ?? 9999),
        }),
      ),
  }));
}

/**
 * Open files past their service level: how long a file may sit at a stage
 * before somebody should have moved it, as set in platform settings.
 */
export async function pastServiceLevel(lens: Lens) {
  const sla = await getSlaDays();
  const late = or(
    ...(["NEW", "PENDING_PARTNER", "IN_PROGRESS", "OFFER", "HOLD"] as const).map((g) =>
      and(eq(sd.group, g), lt(a.statusChangedAt, sql`now() - make_interval(days => ${sla[g] ?? 9999})`)),
    ),
  );
  const [row] = await db.select({ n: count() }).from(a).innerJoin(sd, eq(a.statusId, sd.id)).where(and(lensApps(lens), late));
  return Number(row?.n ?? 0);
}

/**
 * Who on the desk is carrying which open files, with how many of them are
 * late and how long the oldest has waited. A file with no officer yet is its
 * own line, because that is the pile a team leader hands out from.
 */
export async function officerLoad(lens: Lens) {
  const sla = await getSlaDays();
  const late = sql`(${or(
    ...(["NEW", "PENDING_PARTNER", "IN_PROGRESS", "OFFER"] as const).map((g) => and(eq(sd.group, g), lt(a.statusChangedAt, sql`now() - make_interval(days => ${sla[g] ?? 9999})`))),
  )})`;
  const rows = await db
    .select({
      id: a.officerId,
      name: us.name,
      open: count(),
      late: sql<number>`count(*) filter (where ${late})`.mapWith(Number),
      oldest: sql<number>`max(${daysSince(a.statusChangedAt)})`.mapWith(Number),
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .leftJoin(us, eq(a.officerId, us.id))
    .where(and(lensApps(lens), inArray(sd.group, ["NEW", "PENDING_PARTNER", "IN_PROGRESS", "OFFER"])))
    .groupBy(a.officerId, us.name)
    .orderBy(desc(count()));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "Nobody yet", open: Number(r.open), late: Number(r.late), oldest: Number(r.oldest) }));
}

/** Monday of this week, as a date with no time. */
function mondayOf(d = new Date()) {
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The milestones falling due this week on open applications, a day at a
 * time, and how many are already past and not done.
 */
export async function deadlinesThisWeek(lens: Lens, limit = 6) {
  const monday = mondayOf();
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const from = isoDay(days[0]);
  const to = isoDay(days[6]);
  const today = isoDay(new Date());
  const open = and(lensApps(lens), isNull(dl.doneAt));
  const [items, [late]] = await Promise.all([
    db
      .select({ id: dl.id, type: dl.type, dueOn: dl.dueOn, studentId: s.id, student: name, university: un.name, appId: a.id })
      .from(dl)
      .innerJoin(a, eq(dl.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(pr, eq(a.programId, pr.id))
      .innerJoin(un, eq(pr.universityId, un.id))
      .where(and(open, gte(dl.dueOn, from), lte(dl.dueOn, to)))
      .orderBy(asc(dl.dueOn)),
    db.select({ n: count() }).from(dl).innerJoin(a, eq(dl.applicationId, a.id)).where(and(open, lt(dl.dueOn, today))),
  ]);
  return {
    today,
    days: days.map((d) => ({ date: isoDay(d), n: items.filter((i) => i.dueOn === isoDay(d)).length })),
    items: items.slice(0, limit),
    total: items.length,
    late: Number(late?.n ?? 0),
  };
}

/** The states that mean a document is still owed or still being looked at. */
const OUTSTANDING = ["ASKED", "UPLOADED", "IN_REVIEW", "REJECTED"] as const;
const IN = ["UPLOADED", "IN_REVIEW", "ACCEPTED"] as const;

/**
 * The students who still owe documents, least complete first: of what has
 * been asked of them, how much has come in. Only students with something
 * still to come, because a full file needs nobody's attention.
 */
export async function documentsToCome(lens: Lens, limit = 5) {
  const asked = notInArray(ci.state, ["NOT_NEEDED", "NOT_ASKED"]);
  const rows = await db
    .select({
      id: s.id,
      student: name,
      asked: count(),
      in: sql<number>`count(*) filter (where ${inArray(ci.state, [...IN])})`.mapWith(Number),
      owed: sql<number>`count(*) filter (where ${inArray(ci.state, ["ASKED", "REJECTED"])})`.mapWith(Number),
    })
    .from(ci)
    .innerJoin(s, eq(ci.studentId, s.id))
    .where(and(lensStudents(lens), eq(s.archived, false), asked))
    .groupBy(s.id, s.firstName, s.lastName)
    .having(sql`count(*) filter (where ${inArray(ci.state, [...OUTSTANDING])}) > 0`)
    .orderBy(sql`count(*) filter (where ${inArray(ci.state, [...IN])})::float / count(*) asc`, asc(s.firstName));
  return {
    rows: rows.slice(0, limit).map((r) => ({ id: r.id, student: r.student, asked: Number(r.asked), in: Number(r.in), owed: Number(r.owed) })),
    students: rows.length,
    owed: rows.reduce((n, r) => n + Number(r.owed), 0),
  };
}

/**
 * The people in a branch side by side: students they carry, applications
 * made for them, and offers come back, ranked by students. For a branch head
 * this is the team; somebody at the desk viewing as a branch sees every
 * branch's people together.
 */
export async function teamBoard(lens: Lens, limit = 8) {
  const people = and(
    lensOrg(lens, us.orgId),
    eq(us.active, true),
    inArray(us.role, ["PARTNER", ...COUNSELLING_ROLES.filter((r) => r !== "DESK_COUNSELLOR")]),
  );
  const offerOrLater = sql`exists (select 1 from ${sh} h join ${sd} d on d.id = h.to_status_id where h.application_id = ${a.id} and (d."group" = 'OFFER' or d.code in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')))`;
  const rows = await db
    .select({
      id: us.id,
      name: us.name,
      branch: og.name,
      students: sql<number>`count(distinct ${s.id})`.mapWith(Number),
      applications: sql<number>`count(distinct ${a.id})`.mapWith(Number),
      offers: sql<number>`count(distinct ${a.id}) filter (where ${offerOrLater})`.mapWith(Number),
    })
    .from(us)
    .innerJoin(og, eq(us.orgId, og.id))
    .leftJoin(s, and(eq(s.assignedToId, us.id), eq(s.archived, false)))
    .leftJoin(a, eq(a.studentId, s.id))
    .where(people)
    .groupBy(us.id, us.name, og.name)
    .orderBy(desc(sql`count(distinct ${s.id})`), asc(us.name))
    .limit(limit);
  return rows.map((r) => ({ ...r, students: Number(r.students), applications: Number(r.applications), offers: Number(r.offers) }));
}

/**
 * A counsellor's follow-ups: what is late, what is due today, and the next
 * few. Somebody viewing as a counsellor without picking one reads the
 * follow-ups of everybody the lens covers.
 */
export async function followUps(lens: Lens, limit = 6) {
  const today = isoDay(new Date());
  const whose = lens.person ? eq(tk.assignedToId, lens.person.id) : lensOrg(lens, tk.orgId);
  const open = and(whose, isNull(tk.doneAt));
  const [[c], rows] = await Promise.all([
    db
      .select({
        late: sql<number>`count(*) filter (where ${tk.dueOn} < ${today})`.mapWith(Number),
        today: sql<number>`count(*) filter (where ${tk.dueOn} = ${today})`.mapWith(Number),
        open: count(),
      })
      .from(tk)
      .where(open),
    db
      .select({ id: tk.id, title: tk.title, dueOn: tk.dueOn, studentId: tk.studentId, student: sql<string | null>`${s.firstName} || ' ' || ${s.lastName}` })
      .from(tk)
      .leftJoin(s, eq(tk.studentId, s.id))
      .where(open)
      .orderBy(asc(tk.dueOn))
      .limit(limit),
  ]);
  return { late: Number(c?.late ?? 0), today: Number(c?.today ?? 0), open: Number(c?.open ?? 0), rows, todayIs: today };
}

/* ---------------- The documentation desk ---------------- */

/** The organisation filter for checklist rows, through their student. */
const docScope = (lens: Lens) => and(lensOrg(lens, s.orgId), eq(s.archived, false));

/**
 * The documentation desk's figures. All of them are the state of things now:
 * a document is waiting or it is not, and "this month" does not change that.
 */
export async function documentFigures(lens: Lens) {
  const mine = lens.viewingAs ? null : lens.user.id;
  const [row] = await db
    .select({
      waiting: sql<number>`count(*) filter (where ${inArray(ci.state, ["UPLOADED", "IN_REVIEW"])} and ${ci.claimedById} is null)`.mapWith(Number),
      claimed: mine
        ? sql<number>`count(*) filter (where ${inArray(ci.state, ["UPLOADED", "IN_REVIEW"])} and ${ci.claimedById} = ${mine})`.mapWith(Number)
        : sql<number>`count(*) filter (where ${inArray(ci.state, ["UPLOADED", "IN_REVIEW"])} and ${ci.claimedById} is not null)`.mapWith(Number),
      asked: sql<number>`count(*) filter (where ${ci.state} = 'ASKED')`.mapWith(Number),
      sentBack: sql<number>`count(*) filter (where ${ci.state} = 'REJECTED')`.mapWith(Number),
      overdue: sql<number>`count(*) filter (where ${inArray(ci.state, ["ASKED", "REJECTED"])} and ${ci.dueOn} is not null and ${ci.dueOn} < current_date)`.mapWith(Number),
      acceptedWeek: sql<number>`count(*) filter (where ${ci.state} = 'ACCEPTED' and ${ci.decidedAt} >= now() - interval '7 days')`.mapWith(Number),
      expiring: sql<number>`count(*) filter (where ${ci.state} = 'ACCEPTED' and ${ci.validTo} is not null and ${ci.validTo} between current_date and current_date + 60)`.mapWith(Number),
      students: sql<number>`count(distinct ${ci.studentId}) filter (where ${inArray(ci.state, [...OUTSTANDING])})`.mapWith(Number),
    })
    .from(ci)
    .innerJoin(s, eq(ci.studentId, s.id))
    .where(docScope(lens));
  return { ...(row ?? { waiting: 0, claimed: 0, asked: 0, sentBack: 0, overdue: 0, acceptedWeek: 0, expiring: 0, students: 0 }), mine: mine !== null };
}

/** The documentation board's columns, in the order a document moves. */
export const DOC_COLUMNS = [
  { key: "ASKED", label: "Asked, not in", blurb: "Waiting on the student" },
  { key: "UPLOADED", label: "Waiting for a check", blurb: "Nobody has it yet" },
  { key: "IN_REVIEW", label: "Being checked", blurb: "Claimed by somebody" },
  { key: "REJECTED", label: "Sent back", blurb: "Waiting on a better copy" },
  { key: "ACCEPTED", label: "Accepted this week", blurb: "Done in the last seven days" },
] as const;

export type DocCard = { id: string; studentId: string; student: string; document: string; branch: string; days: number; who: string | null; overdue: boolean };

/**
 * Every document in play as a card, oldest first in each column. A document
 * that has been uploaded and claimed counts as being checked, whatever its
 * stored state, because that is what is happening to it.
 */
export async function documentBoard(lens: Lens, perColumn = 4) {
  const column = sql<string>`case
    when ${ci.state} in ('UPLOADED','IN_REVIEW') and ${ci.claimedById} is not null then 'IN_REVIEW'
    when ${ci.state} in ('UPLOADED','IN_REVIEW') then 'UPLOADED'
    else ${ci.state}::text end`;
  const since = sql`coalesce(${ci.decidedAt}, ${ci.askedAt}, ${ci.updatedAt})`;
  const live = or(inArray(ci.state, [...OUTSTANDING]), and(eq(ci.state, "ACCEPTED"), gte(ci.decidedAt, sql`now() - interval '7 days'`)));
  const claimer = schema.users;
  const rows = await db
    .select({
      id: ci.id,
      studentId: s.id,
      student: name,
      document: dt.label,
      branch: og.name,
      column,
      days: daysSince(since),
      who: claimer.name,
      overdue: sql<boolean>`${ci.dueOn} is not null and ${ci.dueOn} < current_date and ${ci.state} in ('ASKED','REJECTED')`,
      rank: sql<number>`row_number() over (partition by ${column} order by ${since} asc)`.mapWith(Number),
      total: sql<number>`count(*) over (partition by ${column})`.mapWith(Number),
    })
    .from(ci)
    .innerJoin(s, eq(ci.studentId, s.id))
    .innerJoin(dt, eq(ci.typeCode, dt.code))
    .innerJoin(og, eq(s.orgId, og.id))
    .leftJoin(claimer, eq(ci.claimedById, claimer.id))
    .where(and(docScope(lens), live));
  return DOC_COLUMNS.map((c) => {
    const mine = rows.filter((r) => r.column === c.key);
    return {
      ...c,
      total: mine[0] ? Number(mine[0].total) : 0,
      cards: mine
        .filter((r) => r.rank <= perColumn)
        .sort((x, y) => x.rank - y.rank)
        .map((r): DocCard => ({ id: r.id, studentId: r.studentId, student: r.student, document: r.document, branch: r.branch, days: Number(r.days), who: r.who, overdue: Boolean(r.overdue) })),
    };
  });
}

/** Counted here so the menu of a counsellor's dashboard can show "my students". */
export async function studentsCounted(lens: Lens) {
  const [row] = await db.select({ n: count() }).from(s).where(and(lensStudents(lens), eq(s.archived, false)));
  return Number(row?.n ?? 0);
}

/** Students nobody has been given to, in a branch, for the branch head. */
export async function unassigned(lens: Lens) {
  const [row] = await db
    .select({ n: count() })
    .from(s)
    .where(and(lensOrg(lens, s.orgId), eq(s.archived, false), isNull(s.assignedToId)));
  return Number(row?.n ?? 0);
}
