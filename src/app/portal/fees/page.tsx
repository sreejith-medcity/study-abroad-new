import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDate } from "@/lib/format";
import { translator, type Phrase } from "@/lib/i18n";
import { balanceDue, instalmentDueWords, rupees } from "@/lib/student-fees";
import { requireStudent } from "@/server/portal";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The student's own fees: what has been invoiced, what they have paid, what
 * is still to pay and a way to pay it online where the branch sent a link.
 * Drafts and cancelled invoices are the branch's business and are not shown.
 */
export default async function PortalFees() {
  const { student, locale } = await requireStudent();
  const t = translator(locale);
  const { feeInvoices: fi, feeReceipts: fr, feePaymentLinks: pl, feeInstalments: fs } = schema;
  const [invoices, receipts, scheduled] = await Promise.all([
    db
      .select()
      .from(fi)
      .where(and(eq(fi.studentId, student.id), inArray(fi.state, ["ISSUED", "PART_PAID", "PAID", "WRITTEN_OFF"])))
      .orderBy(desc(fi.issuedOn)),
    db.select({ r: fr, invoiceNumber: fi.number }).from(fr).innerJoin(fi, eq(fi.id, fr.invoiceId)).where(eq(fr.studentId, student.id)).orderBy(desc(fr.receivedOn)),
    db.select().from(fs).where(and(eq(fs.studentId, student.id), eq(fs.state, "SCHEDULED"))).orderBy(asc(fs.seq)),
  ]);
  const links = invoices.length
    ? await db.select().from(pl).where(and(inArray(pl.invoiceId, invoices.map((i) => i.id)), eq(pl.state, "CREATED")))
    : [];
  const linkBy = new Map(links.map((l) => [l.invoiceId, l]));

  return (
    <div className="space-y-5">
      <h1 className="font-display text-[1.5rem] font-semibold text-ink">{t("feesTitle")}</h1>
      {invoices.length === 0 ? (
        <EmptyState title={t("feesTitle")}>{t("feesNone")}</EmptyState>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            const bal = balanceDue(inv.total, inv.received) ?? 0;
            const link = linkBy.get(inv.id);
            return (
              <Card key={inv.id} className="p-4" data-invoice={inv.number ?? ""}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{inv.number}</span>
                  <Chip tone={inv.state === "PAID" ? "ok" : inv.state === "PART_PAID" ? "warn" : inv.state === "ISSUED" ? "info" : "neutral"}>{t(`feesState${inv.state}` as Phrase)}</Chip>
                  <a href={`/print/fees/invoice/${inv.id}`} target="_blank" className="ml-auto text-sm font-medium text-brand-600 hover:underline">
                    {t("feesPrintInvoice")}
                  </a>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">{t("feesDue")}</dt>
                    <dd>{inv.dueOn ? fmtDate(inv.dueOn) : "Not recorded"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t("feesTotal")}</dt>
                    <dd className="tabular">{rupees(inv.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{t("feesPaid")}</dt>
                    <dd className="tabular">{rupees(inv.received)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">{inv.refunded ? t("feesRefunded") : t("feesBalance")}</dt>
                    <dd className="tabular font-semibold">{inv.refunded ? rupees(inv.refunded) : inv.state === "WRITTEN_OFF" ? rupees(0) : rupees(bal)}</dd>
                  </div>
                </dl>
                {link && bal > 0 && (inv.state === "ISSUED" || inv.state === "PART_PAID") && (
                  <a href={link.url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
                    {t("feesPayOnline")} {rupees(link.amount)}
                  </a>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {scheduled.length > 0 && (
        <Card>
          <CardHeader title={t("feesComingUp")} subtitle={t("feesComingUpNote")} />
          <ul className="divide-y divide-line px-4 pb-3 text-sm">
            {scheduled.map((s) => (
              <li key={s.id} className="flex justify-between gap-3 py-2">
                <span>
                  {s.label}
                  <span className="block text-xs text-muted">{s.dueOn ? fmtDate(s.dueOn) : instalmentDueWords(s)}</span>
                </span>
                <span className="tabular">{rupees(s.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={t("feesReceipts")} />
        {receipts.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">{t("feesNoReceipts")}</p>
        ) : (
          <ul className="divide-y divide-line px-4 pb-3 text-sm">
            {receipts.map(({ r, invoiceNumber }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-receipt={r.number}>
                <span>
                  <span className="font-mono">{r.number}</span>
                  <span className="block text-xs text-muted">
                    {fmtDate(r.receivedOn)} · {invoiceNumber}
                  </span>
                </span>
                <span className="tabular">{rupees(r.amount)}</span>
                <a href={`/print/fees/receipt/${r.id}`} target="_blank" className="text-sm font-medium text-brand-600 hover:underline">
                  {t("feesPrintReceipt")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
