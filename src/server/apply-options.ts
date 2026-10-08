import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { tuitionText } from "@/lib/catalogue";
import { routeChips } from "@/server/vendors";
import { commissionVisible } from "@/server/commission-visibility";

/** One course as the apply picker needs it: enough to choose with, and no more. */
export type ProgramOption = {
  id: string;
  name: string;
  university: string;
  country: string;
  pathway: "DEGREE" | "AUSBILDUNG" | "NURSING";
  intakeMonths: number[];
  shortlisted: boolean;
  tuition: string;
  requirements: string;
  /** Last day to apply, keyed "yyyy-m" by intake. */
  deadlines: Record<string, string>;
  /** The roads this course can be applied down, live ones only. */
  routes: { id: string; code: string; name: string; colour: string; commission: string | null }[];
};

/**
 * The courses a counsellor can pick from, searched on the server.
 *
 * The catalogue is tens of thousands of rows, so it has never been sent to the
 * browser whole. It used to arrive as the first fifty by name behind a Find
 * button, which is why the picker looked like it had not finished loading and
 * why nobody could find a course by typing. The same function now answers the
 * page's first paint and every keystroke in the picker.
 */
export async function applyOptions(
  user: SessionUser,
  opts: { studentId: string; q?: string; country?: string; pathway?: string; preselectProgramId?: string; limit?: number },
): Promise<ProgramOption[]> {
  const { programs: p, universities: u, countries: c } = schema;
  const openable = eq(p.status, "LIVE");
  const columns = {
    id: p.id, name: p.name, pathway: p.pathway, intakeMonths: p.intakeMonths, campus: p.campus,
    tuitionPerYear: p.tuitionPerYear, tuitionTotal: p.tuitionTotal, applicationFee: p.applicationFee, offerTatDays: p.offerTatDays,
    minIelts: p.minIelts, minPte: p.minPte, minOetGrade: p.minOetGrade, minGermanLevel: p.minGermanLevel, maxBacklogs: p.maxBacklogs,
    moiAccepted: p.moiAccepted, minToefl: p.minToefl, minDuolingo: p.minDuolingo, minAcademicPercent: p.minAcademicPercent,
    university: u.name, country: c.name, currency: c.currency,
  };
  const base = () => db.select(columns).from(p).innerJoin(u, eq(p.universityId, u.id)).innerJoin(c, eq(u.countryId, c.id));
  const q = (opts.q ?? "").trim();
  const [matches, picked, preselected] = await Promise.all([
    base()
      .where(and(
        openable,
        opts.pathway ? eq(p.pathway, opts.pathway as schema.Pathway) : undefined,
        opts.country ? eq(c.code, opts.country) : undefined,
        q ? or(ilike(p.name, `%${q}%`), ilike(u.name, `%${q}%`)) : undefined,
      ))
      .orderBy(asc(p.name))
      .limit(opts.limit ?? 25),
    // The student's own shortlist is always offered, whatever the search says:
    // it is the shortest road to the course they have already talked about.
    base().innerJoin(schema.shortlists, eq(schema.shortlists.programId, p.id)).where(and(openable, eq(schema.shortlists.studentId, opts.studentId))).orderBy(asc(p.name)),
    opts.preselectProgramId ? base().where(and(openable, eq(p.id, opts.preselectProgramId))) : Promise.resolve([]),
  ]);
  const shortlisted = new Set(picked.map((r) => r.id));
  // A search narrows the shortlist too, so typing never leaves a course on the
  // list that has nothing to do with what was typed.
  const keep = q || opts.country || opts.pathway
    ? picked.filter((r) =>
        (!q || `${r.name} ${r.university}`.toLowerCase().includes(q.toLowerCase())) &&
        (!opts.pathway || r.pathway === opts.pathway),
      )
    : picked;
  const seen = new Set<string>();
  const rows = [...preselected, ...keep, ...matches].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  if (rows.length === 0) return [];

  const showCommission = await commissionVisible(user);
  const routesByProgram = await routeChips(
    rows.map((r) => ({ id: r.id, tuitionPerYear: r.tuitionPerYear, tuitionTotal: r.tuitionTotal, applicationFee: r.applicationFee, offerTatDays: r.offerTatDays, currency: r.currency })),
  );
  const routeIds = await db
    .select({ id: schema.programRoutes.id, programId: schema.programRoutes.programId, vendorId: schema.programRoutes.vendorId })
    .from(schema.programRoutes)
    .where(inArray(schema.programRoutes.programId, rows.map((r) => r.id)));
  const deadlineRows = await db
    .select({ programId: schema.programDeadlines.programId, month: schema.programDeadlines.intakeMonth, year: schema.programDeadlines.intakeYear, deadline: schema.programDeadlines.deadline })
    .from(schema.programDeadlines)
    .where(inArray(schema.programDeadlines.programId, rows.map((r) => r.id)));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    university: r.campus ? `${r.university} (${r.campus})` : r.university,
    country: r.country,
    pathway: r.pathway,
    intakeMonths: r.intakeMonths,
    shortlisted: shortlisted.has(r.id),
    tuition: tuitionText(r.tuitionPerYear, r.tuitionTotal, r.currency),
    routes: (routesByProgram.get(r.id) ?? [])
      .filter((x) => x.active)
      .map((x) => ({
        id: routeIds.find((y) => y.programId === r.id && y.vendorId === x.vendorId)?.id ?? "",
        code: x.code,
        name: x.name,
        colour: x.colour,
        commission: showCommission ? (x.commission.known ? fmtMoney(x.commission.amount, x.commission.currency) : null) : null,
      }))
      .filter((x) => x.id),
    deadlines: Object.fromEntries(deadlineRows.filter((d) => d.programId === r.id).map((d) => [`${d.year}-${d.month}`, d.deadline])),
    requirements: [
      r.minIelts && `IELTS ${r.minIelts}`,
      r.minPte && `PTE ${r.minPte}`,
      r.minToefl != null && `TOEFL ${r.minToefl}`,
      r.minDuolingo != null && `Duolingo ${r.minDuolingo}`,
      r.minAcademicPercent != null && `marks ${r.minAcademicPercent}%+`,
      r.minOetGrade && `OET ${r.minOetGrade}`,
      r.minGermanLevel && `German ${r.minGermanLevel}`,
      r.maxBacklogs != null && `backlogs ≤ ${r.maxBacklogs}`,
      r.moiAccepted && "MOI accepted",
    ].filter(Boolean).join(", "),
  }));
}

/** The destinations with something open to apply to, for the picker's filter. */
export async function applyCountries() {
  const { programs: p, universities: u, countries: c } = schema;
  return db
    .selectDistinct({ code: c.code, name: c.name })
    .from(c)
    .innerJoin(u, eq(u.countryId, c.id))
    .innerJoin(p, eq(p.universityId, u.id))
    .where(eq(p.status, "LIVE"))
    .orderBy(asc(c.name));
}
