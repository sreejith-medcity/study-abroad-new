import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LEVEL_LABEL } from "@/lib/catalogue";
import { MONTHS } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { PROGRAM_TAGS } from "@/lib/program-tags";
import { fxRates, getSettings } from "@/server/settings";
import { adhocStudent, readSearch, searchConds } from "@/server/program-search";

export const dynamic = "force-dynamic";

const TOP = 500;

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and escape quotes
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Search results as a spreadsheet a partner can pass on: either the programs
 * ticked on screen, or the first 500 matches of the current search in its
 * order. No commission column, since the file may reach the student. Blank
 * cells stay blank: a fee nobody verified is never written as zero.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !(APP_ROLES as readonly string[]).includes(user.role)) return new Response("Not allowed", { status: 403 });
  const params = new URL(req.url).searchParams;
  const ids = params.getAll("id").filter((x) => /^[A-Za-z0-9_-]{8,40}$/.test(x)).slice(0, TOP);
  const raw: Record<string, string[]> = {};
  for (const [k, v] of params) (raw[k] ??= []).push(v);
  const f = readSearch(raw);
  const { programs: p, universities: u, countries: c, students: s } = schema;

  let where;
  if (ids.length) {
    where = and(eq(p.status, "LIVE"), inArray(p.id, ids));
  } else {
    const student = f.student
      ? await db.query.students.findFirst({ where: and(eq(s.id, f.student), isStaff(user) ? undefined : eq(s.orgId, user.orgId)), with: { tests: true, academics: true } })
      : null;
    const checker = student ?? adhocStudent(f);
    where = and(...searchConds(f, checker, fxRates(await getSettings())));
  }

  const rows = await db
    .select({
      name: p.name, university: u.name, campus: sql<string | null>`coalesce(${p.campus}, ${u.city})`, country: c.name, currency: c.currency,
      level: p.level, field: p.studyArea, months: p.durationMonths, perYear: p.tuitionPerYear, total: p.tuitionTotal,
      appFee: p.applicationFee, deposit: p.initialDeposit, balance: p.balanceDeposit, scholarship: p.typicalScholarship, intakes: p.intakeMonths,
      ielts: p.minIelts, band: p.minIeltsBand, pte: p.minPte, toefl: p.minToefl, duolingo: p.minDuolingo, oet: p.minOetGrade, german: p.minGermanLevel,
      gre: p.minGre, gmat: p.minGmat, sat: p.minSat, academic: p.minAcademicPercent, entry: p.entryRequirements, backlogs: p.maxBacklogs, moi: p.moiAccepted,
      waiver: p.feeWaiver, workRights: p.workRights, tags: p.tags, url: p.programUrl,
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .orderBy(
      ...(f.sort === "rank"
        ? [sql`${u.rankSort} asc nulls last`, asc(u.name), asc(p.name)]
        : f.sort === "fee"
          ? [sql`${p.tuitionPerYear} is null`, asc(p.tuitionPerYear), sql`${p.tuitionTotal} is null`, asc(p.tuitionTotal), asc(p.name)]
          : f.sort === "name"
            ? [asc(p.name), asc(u.name)]
            : [asc(c.name), asc(u.name), asc(p.name)]),
    )
    .limit(TOP);

  const header = ["Program", "University", "Campus", "Country", "Level", "Field of study", "Duration (months)", "Tuition per year", "Tuition, whole course", "Currency", "Application fee", "Deposit", "Balance deposit", "Typical scholarship", "Intakes", "Min IELTS", "No IELTS band below", "Min PTE", "Min TOEFL iBT", "Min Duolingo", "Min OET", "German level", "Min GRE", "Min GMAT", "Min SAT", "Min marks (%)", "Other entry requirements", "Max backlogs", "MOI accepted", "Application fee waiver", "Post-study work", "Labels", "Program page"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.name, r.university, r.campus, r.country, LEVEL_LABEL[r.level] ?? r.level, r.field, r.months, r.perYear, r.total, r.currency,
      r.appFee, r.deposit, r.balance, r.scholarship, r.intakes.map((m) => MONTHS[m - 1]).join(" "),
      r.ielts, r.band, r.pte, r.toefl, r.duolingo, r.oet, r.german, r.gre, r.gmat, r.sat, r.academic, r.entry, r.backlogs, r.moi ? "Yes" : "",
      r.waiver, r.workRights === "ELIGIBLE" ? "Eligible" : r.workRights === "INELIGIBLE" ? "Not eligible" : "Not confirmed",
      r.tags.map((t) => PROGRAM_TAGS[t as keyof typeof PROGRAM_TAGS] ?? t).join("; "), r.url,
    ].map(csvCell).join(","));
  }
  await audit(user.id, "programs.search_export", "program", "*", { count: rows.length, ticked: ids.length });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="programs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
