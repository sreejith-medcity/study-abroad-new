import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDate } from "@/lib/format";
import { translator, type Phrase } from "@/lib/i18n";
import { balanceDue, fullyRefunded, instalmentDueWords, rupees } from "@/lib/student-fees";
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
  const { feeInvoices: fi, feeReceipts: fr, feePaymentLinks: pl, feeInstalments: fs, feeRefunds: rf } = schema;
  const [invoices, receipts, scheduled] = await Promise.all([
    db
      .select()
      .from(fi)
      .where(and(eq(fi.studentId, student.id), inArray(fi.state, ["ISSUED", "PART_PAID", "PAID", "WRITTEN_OFF"])))
      .orderBy(desc(fi.issuedOn)),
    db.select({ r: fr, invoiceNumber: fi.number }).from(fr).innerJoin(fi, eq(fi.id, fr.invoiceId)).where(eq(fr.studentId, student.id)).orderBy(desc(fr.receivedOn)),
    db.select().from(fs).where(and(eq(fs.studentId, student.id), eq(fs.state, "SCHEDULED"))).orderBy(asc(fs.seq)),
  ]);
  const ids = invoices.map((i) => i.id);
  const [links, credits] = ids.length
    ? await Promise.all([
        db.select().from(pl).where(and(inArray(pl.invoiceId, ids), eq(pl.state, "CREATED"))),
        db
          .select({ id: rf.id, invoiceId: rf.invoiceId, number: rf.creditNoteNumber })
          .from(rf)
          .where(and(inArray(rf.invoiceId, ids), eq(rf.state, "PAID")))
          .orderBy(asc(rf.paidAt)),
      ])
    : [[], []];
  const linkBy = new Map(links.map((l) => [l.invoiceId, l]));
  const creditsBy = new Map<string, { id: string; number: string }[]>();
  for (const c of credits) if (c.number) creditsBy.set(c.invoiceId, [...(creditsBy.get(c.invoiceId) ?? []), { id: c.id, number: c.number }]);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-[1.5rem] font-semibold text-ink">{t("feesTitle")}</h1>
      {invoices.length === 0 ? (
        <EmptyState title={t("feesTitle")}>{t("feesNone")}</EmptyState>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            // What is still to pay is the invoice's balance, whatever has been refunded on it.
            const bal = inv.state === "WRITTEN_OFF" ? 0 : (balanceDue(inv.total, inv.received) ?? 0);
            const link = linkBy.get(inv.id);
            const refunded = fullyRefunded(inv);
            return (
              <Card key={inv.id} className="p-4" data-invoice={inv.number ?? ""}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{inv.number}</span>
                  <Chip tone={refunded ? "neutral" : inv.state === "PAID" ? "ok" : inv.state === "PART_PAID" ? "warn" : inv.state === "ISSUED" ? "info" : "neutral"}>
                    {refunded ? t("feesRefunded") : t(`feesState${inv.state}` as Phrase)}
                  </Chip>
                  <a href={`/print/fees/invoice/${inv.id}`} target="_blank" className="ml-auto text-sm font-medium text-brand-600 hover:underline">
                    {t("feesPrintInvoice")}
                  </a>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
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
                    <dt className="text-xs text-muted">{t("feesBalance")}</dt>
                    <dd className="tabular font-semibold">{rupees(bal)}</dd>
                  </div>
                  {inv.refunded > 0 && (
                    <div>
                      <dt className="text-xs text-muted">{t("feesRefunded")}</dt>
                      <dd className="tabular">{rupees(inv.refunded)}</dd>
                    </div>
                  )}
                </dl>
                {(creditsBy.get(inv.id) ?? []).map((c) => (
                  <a key={c.id} href={`/print/fees/credit-note/${c.id}`} target="_blank" className="mt-2 mr-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                    Credit note {c.number}
                  </a>
                ))}
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
