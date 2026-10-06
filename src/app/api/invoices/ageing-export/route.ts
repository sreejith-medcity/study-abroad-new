import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/format";
import { AGE_LABEL, INVOICE_STATE_LABEL } from "@/lib/invoicing";
import { can } from "@/server/capabilities";
import { ageing } from "@/server/invoicing";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // A cell beginning with one of these is a formula to a spreadsheet, and an
  // invoice number beginning with a minus should not run arithmetic on open.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * The ageing report as a file, because a finance meeting runs off a sheet.
 *
 * One row per open invoice rather than the buckets: the buckets are on screen
 * already, and what a meeting needs is the list behind them, sortable by
 * whatever that meeting is actually arguing about.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!(await can(user, "READ_INVOICES"))) return new Response("Not found", { status: 404 });

  const today = new Date();
  const aged = await ageing(today);
  const header = [
    "Invoice",
    "Vendor",
    "Vendor code",
    "State",
    "Raised on",
    "Due on",
    "How late",
    "Days late",
    "Currency",
    "Raised for",
    "Credited back",
    "Received",
    "Still owed",
    "Students",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of aged.invoices) {
    lines.push(
      [
        r.number,
        r.vendor,
        r.vendorCode,
        INVOICE_STATE_LABEL[r.state],
        r.raisedOn ? fmtDate(r.raisedOn) : "Not recorded",
        r.dueOn ? fmtDate(r.dueOn) : "Not recorded",
        AGE_LABEL[r.bucket],
        // Negative days are days still to run, which is not lateness; the bucket
        // beside it already says so, so the figure is left out rather than
        // written as a negative somebody will sum by mistake.
        r.lateDays != null && r.lateDays > 0 ? r.lateDays : "",
        r.currency,
        r.total,
        r.credited,
        r.received,
        r.outstanding,
        r.students,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(user.id, "invoice.ageing_export", "invoice", "*", { invoices: aged.invoices.length });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ageing-${today.toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
