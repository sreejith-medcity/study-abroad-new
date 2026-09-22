import { desc } from "drizzle-orm";
import { schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fmtDate, intakeLabel } from "@/lib/format";
import { applicationsBase, applicationWhere, readFilters } from "@/server/queries";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection and escape quotes
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const user = await getSession();
  if (!user || user.role === "STUDENT") return new Response("Sign in required", { status: 401 });
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const f = readFilters(params);
  const rows = await applicationsBase().where(applicationWhere(user, f)).orderBy(desc(schema.applications.createdAt)).limit(10000);

  const header = ["Ack no", "Date created", "Student", "University", "Country", "Program", "Intake", "Pathway", "Status", "Status since", "Deadline", "Created by", "Officer", "Offer", "Offer date", "Deposit paid", "CAS / I-20 / CoE", "Visa lodged", "Visa decision", "Decision date"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.ackNo, fmtDate(r.createdAt), `${r.firstName} ${r.lastName}`, r.universityName, r.countryName, r.programName,
      intakeLabel(r.intakeMonth, r.intakeYear), r.pathway, r.statusLabel, fmtDate(r.statusChangedAt), fmtDate(r.deadline),
      r.createdByName ?? r.createdByFallback, r.officerName ?? "",
      r.offerType === "UNCONDITIONAL" ? "Unconditional" : r.offerType === "CONDITIONAL" ? "Conditional" : "", r.offerDate, r.depositPaidOn,
      r.confirmationNumber, r.visaLodgedOn, r.visaDecision === "GRANTED" ? "Granted" : r.visaDecision === "REFUSED" ? "Refused" : "", r.visaDecisionOn,
    ].map(csvCell).join(","));
  }
  await audit(user.id, "applications.export", "application", "*", { count: rows.length, filters: f });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="applications-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
