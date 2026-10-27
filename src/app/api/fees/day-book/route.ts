import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { FEE_METHOD_LABEL, csvLine, isDay, istToday } from "@/lib/student-fees";
import { feeAccess, receiptsBetween, refundsPaidBetween } from "@/server/student-fees";

export const dynamic = "force-dynamic";

/**
 * One day's receipts as a sheet, for the cash and bank closing, with the
 * refunds paid out that day as negative lines under their credit note's
 * number where there is one. Audited.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!(await feeAccess(user)).read) return new Response("Not found", { status: 404 });
  const asked = new URL(request.url).searchParams.get("day") ?? "";
  const day = isDay(asked) ? asked : istToday();
  const [rows, refunds] = await Promise.all([receiptsBetween(user, day, day), refundsPaidBetween(user, new Date(`${day}T00:00:00+05:30`), new Date(`${day}T23:59:59.999+05:30`))]);
  const lines = [csvLine(["Receipt", "Received on", "Branch", "Method", "Reference", "Student", "Invoice", "Amount", "Recorded by"])];
  for (const r of rows) {
    lines.push(csvLine([r.receipt.number, r.receipt.receivedOn, r.branch, FEE_METHOD_LABEL[r.receipt.method], r.receipt.reference ?? "", `${r.firstName} ${r.lastName}`, r.invoiceNumber, r.receipt.amount, r.by ?? (r.receipt.method === "RAZORPAY" ? "Razorpay" : "")]));
  }
  for (const r of refunds) {
    const method = r.refund.payoutMethod ? FEE_METHOD_LABEL[r.refund.payoutMethod] : "";
    const number = r.refund.creditNoteNumber ?? r.refund.number;
    lines.push(csvLine([number, day, r.branch, `Refund, ${method}`, r.refund.payoutReference ?? "", `${r.firstName} ${r.lastName}`, r.invoiceNumber, -r.refund.amount, ""]));
  }
  await audit(user.id, "fee_day_book.export", "fee_receipt", day, {
    receipts: rows.length,
    amount: rows.reduce((s, r) => s + r.receipt.amount, 0),
    refunds: refunds.length,
    refunded: refunds.reduce((s, r) => s + r.refund.amount, 0),
  });
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="day-book-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
