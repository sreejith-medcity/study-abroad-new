import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/format";
import { istDay } from "@/lib/journal";
import { isHeadOffice } from "@/lib/enquiry-routing";
import { lostReportCsv, reportPeriod } from "@/lib/lost-reasons";
import { lostInPeriod, mayReadLostReport } from "@/server/lost-reasons";
import { SOURCE_LABEL } from "@/server/enquiries";

/** The lost reasons report as a file: the three counts, then every enquiry behind them. */
export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!mayReadLostReport(user)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const period = reportPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, istDay());
  const everyBranch = isHeadOffice(user) || user.role === "MANAGEMENT";
  const org = everyBranch ? url.searchParams.get("org") || null : null;
  const rows = await lostInPeriod(user, period, org);
  const csv = lostReportCsv(
    rows.map((r) => ({ ...r, lostOn: r.lostOn ? fmtDate(r.lostOn) : null })),
    period,
    (s) => SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s,
  );
  await audit(user.id, "enquiry.lost_report_export", "enquiry", "*", { from: period.from, to: period.to, org: everyBranch ? org : user.orgId, rows: rows.length });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="lost-reasons-${period.from}-to-${period.to}.csv"`,
    },
  });
}
