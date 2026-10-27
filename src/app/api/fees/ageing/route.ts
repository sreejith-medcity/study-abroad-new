import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AGEING_LABEL, ageOf, csvLine, istToday } from "@/lib/student-fees";
import { feeAccess, openBalances } from "@/server/student-fees";

export const dynamic = "force-dynamic";

/**
 * The ageing report as a sheet: one row per open invoice, within the
 * students the person may see. Every download is in the audit log.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!(await feeAccess(user)).read) return new Response("Not found", { status: 404 });
  const today = istToday();
  const rows = await openBalances(user);
  const lines = [csvLine(["Invoice", "Branch", "Student", "Medcity ID", "Issued on", "Due on", "Days late", "Bucket", "Total", "Received", "Balance"])];
  for (const r of rows) {
    const age = ageOf(r.dueOn, today);
    lines.push(csvLine([r.number, r.branch, `${r.firstName} ${r.lastName}`, r.medcityId ?? "", r.issuedOn ?? "", r.dueOn, age.days > 0 ? age.days : "", AGEING_LABEL[age.bucket], r.total, r.received, r.balance]));
  }
  await audit(user.id, "fee_ageing.export", "fee_invoice", "*", { invoices: rows.length, balance: rows.reduce((s, r) => s + r.balance, 0), asOn: today });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="fee-ageing-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
