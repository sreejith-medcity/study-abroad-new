import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LEVEL_LABEL } from "@/lib/catalogue";
import { MONTHS } from "@/lib/format";
import { isAdmin } from "@/lib/permissions";
import { programFilterWhere, readProgramFilters } from "@/server/program-filters";

export const dynamic = "force-dynamic";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and escape quotes
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The admin Programs list as a spreadsheet, with the same filters. Blank cells
 * stay blank: an unverified fee is exported as nothing, never as zero.
 */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user || !isAdmin(user)) return new Response("Not allowed", { status: 403 });
  const params = new URL(req.url).searchParams;
  const f = readProgramFilters((k) => params.get(k));
  const { programs: p, universities: u, countries: c } = schema;
  const rows = await db
    .select({
      code: p.externalCode, source: p.source, name: p.name, university: u.name, campus: p.campus, country: c.name, currency: c.currency,
      level: p.level, pathway: p.pathway, field: p.studyArea, months: p.durationMonths, perYear: p.tuitionPerYear, total: p.tuitionTotal,
      appFee: p.applicationFee, deposit: p.initialDeposit, intakes: p.intakeMonths, ielts: p.minIelts, pte: p.minPte, oet: p.minOetGrade,
      german: p.minGermanLevel, workRights: p.workRights, note: p.workRightsNote, status: p.status,
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(programFilterWhere(f))
    .orderBy(asc(c.name), asc(u.name), asc(p.name))
    .limit(60000);

  const header = ["Program", "University", "Campus", "Country", "Level", "Pathway", "Field of study", "Duration (months)", "Tuition per year", "Tuition, whole course", "Currency", "Application fee", "Deposit", "Intakes", "Min IELTS", "Min PTE", "Min OET", "German level", "Post-study work", "Work rights evidence", "Status", "Source", "Register code"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.name, r.university, r.campus, r.country, LEVEL_LABEL[r.level] ?? r.level, r.pathway, r.field, r.months, r.perYear, r.total, r.currency,
      r.appFee, r.deposit, r.intakes.map((m) => MONTHS[m - 1]).join(" "), r.ielts, r.pte, r.oet, r.german,
      r.workRights === "ELIGIBLE" ? "Eligible" : r.workRights === "INELIGIBLE" ? "Not eligible" : "Not confirmed", r.note, r.status,
      r.source ?? "Researched catalogue", r.code,
    ].map(csvCell).join(","));
  }
  await audit(user.id, "programs.export", "program", "*", { count: rows.length, filters: f });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="programs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
