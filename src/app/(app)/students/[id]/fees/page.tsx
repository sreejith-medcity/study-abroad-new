import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES } from "@/lib/permissions";
import {
  FEE_INVOICE_STATE_LABEL,
  FEE_METHOD_LABEL,
  addDays,
  ageOf,
  balanceDue,
  dueWords,
  gstWords,
  instalmentDueWords,
  istToday,
  refundRoom,
  rupees,
  usesShares,
  type FeeInvoiceState,
} from "@/lib/student-fees";
import { getStudentForUser } from "@/server/queries";
import { billingOrgId, feeAccess, feePlanList, studentFees } from "@/server/student-fees";
import { razorpayConfig } from "@/server/razorpay";
import { Alert, Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";
import {
  ApplyPlan,
  CancelInvoice,
  CancelSchedule,
  DecideRefund,
  DraftGst,
  Fold,
  InvoiceByHand,
  IssueInvoice,
  PayRefund,
  RaiseInstalment,
  RecordReceipt,
  RequestRefund,
  SendLink,
  WriteOff,
} from "@/components/fee-forms";

export const metadata = { title: "Fees" };
export const dynamic = "force-dynamic";

const STATE_TONE: Record<FeeInvoiceState, "neutral" | "info" | "warn" | "ok" | "bad"> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PART_PAID: "warn",
  PAID: "ok",
  CANCELLED: "neutral",
  WRITTEN_OFF: "bad",
};

const REFUND_LABEL: Record<string, string> = { REQUESTED: "Waiting for a decision", APPROVED: "Approved, not yet paid", REJECTED: "Rejected", PAID: "Paid out" };

/**
 * One student's fees: the schedule a plan laid out, the invoices raised from
 * it or by hand, what came in against them and what went back.
 */
export default async function StudentFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const access = await feeAccess(user);
  if (!access.read) {
    return (
      <EmptyState title="Not for the documentation desk">
        Checking a document and knowing what a student owes are kept apart on purpose. Everything you need to check this student&rsquo;s paper is on their
        Documentation tab.
      </EmptyState>
    );
  }
  const today = istToday();
  const [fees, plans, org, rzp] = await Promise.all([
    studentFees(id),
    feePlanList(),
    billingOrgId(student.orgId).then((orgId) => db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) })),
    razorpayConfig(),
  ]);
  const live = fees.instalments.filter((i) => i.state !== "CANCELLED");
  const issued = fees.invoices.filter((i) => i.state !== "DRAFT" && i.state !== "CANCELLED");
  const invoiced = issued.reduce((s, i) => s + (i.total ?? 0) - i.refunded, 0);
  const received = issued.reduce((s, i) => s + i.received - i.refunded, 0);
  const open = fees.invoices.filter((i) => i.state === "ISSUED" || i.state === "PART_PAID");
  const due = open.reduce((s, i) => s + (balanceDue(i.total, i.received) ?? 0), 0);
  const overdue = open.filter((i) => i.dueOn && ageOf(i.dueOn, today).days > 0).reduce((s, i) => s + (balanceDue(i.total, i.received) ?? 0), 0);
  const pendingBy = new Map<string, number>();
  for (const r of fees.refunds) if (r.r.state === "REQUESTED" || r.r.state === "APPROVED") pendingBy.set(r.r.invoiceId, (pendingBy.get(r.r.invoiceId) ?? 0) + r.r.amount);
  const linkBy = new Map(fees.links.map((l) => [l.invoiceId, l]));
  const linesBy = new Map<string, typeof fees.lines>();
  for (const l of fees.lines) linesBy.set(l.invoiceId, [...(linesBy.get(l.invoiceId) ?? []), l]);
  const livePlans = plans.filter((p) => p.active);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <Figure label="Invoiced" value={rupees(invoiced)} hint={`${issued.length} invoice${issued.length === 1 ? "" : "s"} issued`} />
          <Figure label="Received" value={rupees(received)} hint="Less anything refunded" />
          <Figure label="Still due" value={rupees(due)} hint={`${open.length} open`} />
          <Figure label="Overdue" value={rupees(overdue)} hint="Past its due date" tone={overdue > 0 ? "bad" : undefined} />
        </div>
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted" data-testid="tax-note">
          {org?.gstin
            ? `${org.name} has GSTIN ${org.gstin} (${org.state ?? "state not recorded"}), so its invoices are tax invoices. A GST rate that is not recorded is not guessed: the invoice waits as a draft.`
            : `${org?.name ?? "This branch"} has no GSTIN recorded, so its invoices are bills of supply with no GST on them.`}
        </p>
      </Card>

      <Card>
        <CardHeader title="Fee schedule" subtitle={live.length ? `${live[0].planName}, applied ${fmtDate(live[0].createdAt)}` : "A fee plan laid out as instalments, each invoiced on its day or when the file reaches its stage or step."} />
        <div className="p-4 pt-0">
          {live.length > 0 ? (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Instalment</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Due</Th>
                    <Th>GST</Th>
                    <Th>Where it is</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {live.map((i) => {
                    const inv = fees.invoices.find((x) => x.id === i.invoiceId);
                    return (
                      <tr key={i.id} data-instalment={i.label}>
                        <Td className="tabular">{i.seq}</Td>
                        <Td className="font-medium">{i.label}</Td>
                        <Td className="text-right tabular">{rupees(i.amount)}</Td>
                        <Td>{i.dueOn ? fmtDate(i.dueOn) : instalmentDueWords(i)}</Td>
                        <Td>{gstWords(i.gstPercent)}</Td>
                        <Td>{i.state === "INVOICED" ? <span>Invoiced{inv?.number ? ` as ${inv.number}` : " as a draft"}</span> : <span className="text-muted">Scheduled</span>}</Td>
                        <Td>{access.act && i.state === "SCHEDULED" && <RaiseInstalment instalmentId={i.id} dueOn={i.dueOn ?? addDays(today, 7)} />}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {access.act && (
                <div className="mt-3">
                  <CancelSchedule studentId={id} />
                </div>
              )}
            </>
          ) : access.act ? (
            livePlans.length ? (
              <ApplyPlan
                studentId={id}
                today={today}
                plans={livePlans.map((p) => ({
                  id: p.id,
                  name: p.name,
                  shares: usesShares(p.items),
                  summary: p.items.map((it) => `${it.label}: ${it.share != null ? `${it.share}%` : rupees(it.amount)} ${dueWords(it)}`).join("; "),
                }))}
              />
            ) : (
              <p className="text-sm text-muted">No fee plans are kept yet. Finance or the head office adds them under Student fees, Fee plans.</p>
            )
          ) : (
            <p className="text-sm text-muted">No fee schedule on this student.</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Invoices" subtitle="Numbered per branch and financial year when issued. A draft has no number yet." />
        <div className="space-y-3 p-4 pt-0">
          {fees.invoices.length === 0 && <p className="text-sm text-muted">No invoices yet.</p>}
          {fees.invoices.map((inv) => {
            const bal = balanceDue(inv.total, inv.received);
            const room = refundRoom(inv.received, inv.refunded, pendingBy.get(inv.id) ?? 0);
            const link = linkBy.get(inv.id);
            const late = inv.dueOn && (inv.state === "ISSUED" || inv.state === "PART_PAID") ? ageOf(inv.dueOn, today).days : 0;
            return (
              <div key={inv.id} data-invoice={inv.number ?? "draft"} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{inv.number ?? "Draft"}</span>
                  <Chip tone={STATE_TONE[inv.state]}>{FEE_INVOICE_STATE_LABEL[inv.state]}</Chip>
                  {inv.kind && <span className="text-xs text-muted">{inv.kind === "TAX_INVOICE" ? "Tax invoice" : "Bill of supply"}</span>}
                  {late > 0 && <Chip tone="bad">{late} days late</Chip>}
                  {inv.number && (
                    <Link href={`/print/fees/invoice/${inv.id}`} className="ml-auto text-sm font-medium text-brand-600 hover:underline" target="_blank">
                      Print invoice
                    </Link>
                  )}
                </div>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {(linesBy.get(inv.id) ?? []).map((l) => (
                    <li key={l.id} className="flex justify-between gap-3">
                      <span>{l.description}</span>
                      <span className="tabular">{rupees(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-6">
                  <Pair k="Issued" v={inv.issuedOn ? fmtDate(inv.issuedOn) : "Not yet"} />
                  <Pair k="Due" v={inv.dueOn ? fmtDate(inv.dueOn) : "Not recorded"} />
                  <Pair k="GST" v={inv.state === "DRAFT" ? (inv.gstPercent == null ? "Rate not recorded" : `${inv.gstPercent}%`) : inv.kind === "TAX_INVOICE" ? rupees((inv.cgst ?? 0) + (inv.sgst ?? 0) + (inv.igst ?? 0)) : "None, bill of supply"} />
                  <Pair k="Total" v={inv.total == null ? "Not recorded" : rupees(inv.total)} />
                  <Pair k="Received" v={rupees(inv.received)} />
                  <Pair k={inv.refunded ? "Refunded" : "Balance"} v={inv.refunded ? rupees(inv.refunded) : bal == null ? "Not recorded" : rupees(bal)} />
                </dl>
                {inv.refunded > 0 && <p className="mt-1 text-xs text-muted">Balance {bal == null ? "not recorded" : rupees(bal)}. Net fee after refunds {rupees((inv.total ?? 0) - inv.refunded)}.</p>}
                {inv.closedReason && <p className="mt-1 text-xs text-muted">{FEE_INVOICE_STATE_LABEL[inv.state]}: {inv.closedReason}</p>}
                {link && (
                  <p className="mt-1 text-xs">
                    Payment link for {rupees(link.amount)}:{" "}
                    <a href={link.url} className="font-mono text-brand-600 hover:underline" target="_blank" rel="noreferrer">
                      {link.url}
                    </a>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  {inv.state === "DRAFT" && access.act && (
                    <>
                      <IssueInvoice invoiceId={inv.id} />
                      <div className="w-56">
                        <DraftGst invoiceId={inv.id} gstPercent={inv.gstPercent} />
                      </div>
                    </>
                  )}
                  {(inv.state === "ISSUED" || inv.state === "PART_PAID") && access.act && bal != null && bal > 0 && (
                    <>
                      {rzp?.enabled && <SendLink invoiceId={inv.id} />}
                      <div className="w-full md:w-96">
                        <RecordReceipt invoiceId={inv.id} due={bal} today={today} />
                      </div>
                    </>
                  )}
                  {access.act && room > 0 && (
                    <div className="w-full md:w-80">
                      <RequestRefund invoiceId={inv.id} room={room} />
                    </div>
                  )}
                  {(inv.state === "DRAFT"
                    ? access.act
                    : access.desk && (inv.state === "ISSUED" || inv.state === "PART_PAID" || (inv.state === "PAID" && inv.received - inv.refunded <= 0))) && (
                    <div className="w-full md:w-72">
                      <CancelInvoice invoiceId={inv.id} draft={inv.state === "DRAFT"} />
                    </div>
                  )}
                  {access.desk && (inv.state === "ISSUED" || inv.state === "PART_PAID") && (
                    <div className="w-full md:w-72">
                      <WriteOff invoiceId={inv.id} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {access.act && (
            <Fold label="Raise an invoice by hand">
              <InvoiceByHand studentId={id} defaultDue={addDays(today, 7)} />
            </Fold>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Receipts" subtitle="Every payment, with its own number." />
        {fees.receipts.length === 0 ? (
          <p className="p-4 pt-0 text-sm text-muted">Nothing received yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Received on</Th>
                <Th>Against</Th>
                <Th>How</Th>
                <Th className="text-right">Amount</Th>
                <Th>Recorded by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {fees.receipts.map(({ r, invoiceNumber, by }) => (
                <tr key={r.id} data-receipt={r.number}>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td>{fmtDate(r.receivedOn)}</Td>
                  <Td className="font-mono text-xs">{invoiceNumber}</Td>
                  <Td>
                    {FEE_METHOD_LABEL[r.method]}
                    {r.reference && <span className="block text-xs text-muted">{r.reference}</span>}
                  </Td>
                  <Td className="text-right tabular">{rupees(r.amount)}</Td>
                  <Td>{by ?? (r.method === "RAZORPAY" ? "Razorpay" : "Not recorded")}</Td>
                  <Td>
                    <Link href={`/print/fees/receipt/${r.id}`} target="_blank" className="text-sm font-medium text-brand-600 hover:underline">
                      Print receipt
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {fees.refunds.length > 0 && (
        <Card>
          <CardHeader title="Refunds" subtitle="Asked for by one person, decided by finance or the head office, never by the same person." />
          <Table>
            <thead>
              <tr>
                <Th>Refund</Th>
                <Th>Against</Th>
                <Th className="text-right">Amount</Th>
                <Th>Asked for by</Th>
                <Th>Where it is</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {fees.refunds.map(({ r, invoiceNumber, by }) => (
                <tr key={r.id} data-refund={r.number}>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td className="font-mono text-xs">{invoiceNumber}</Td>
                  <Td className="text-right tabular">{rupees(r.amount)}</Td>
                  <Td>
                    {by}
                    <span className="block text-xs text-muted">{r.reason}</span>
                  </Td>
                  <Td>
                    {REFUND_LABEL[r.state]}
                    {r.payoutReference && <span className="block text-xs text-muted">Reference {r.payoutReference}</span>}
                    {r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}
                  </Td>
                  <Td>
                    {access.desk && r.state === "REQUESTED" && (r.requestedById === user.id ? <span className="text-xs text-muted">Somebody else decides your own request</span> : <DecideRefund refundId={r.id} />)}
                    {access.desk && r.state === "APPROVED" && <PayRefund refundId={r.id} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {!access.act && <Alert tone="info">Your role reads this student&rsquo;s fees. Raising an invoice or taking a payment is for the branch head, the counsellor or finance.</Alert>}
    </div>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "bad" }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={tone === "bad" ? "font-semibold text-stop-700" : "font-semibold"}>{value}</p>
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="tabular">{v}</dd>
    </div>
  );
}
