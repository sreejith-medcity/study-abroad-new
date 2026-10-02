import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { isStaff, REPORTING_ROLES } from "@/lib/permissions";
import { ageing, invoiceList, queueByVendor } from "@/server/invoicing";
import { AGE_LABEL, AGE_ORDER, INVOICE_STATE_LABEL, taxFor } from "@/lib/invoicing";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { QueueNote, RaiseInvoice } from "@/components/invoice-forms";
import type { InvoiceState } from "@/db/schema";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "queue", label: "To invoice" },
  { key: "invoices", label: "Invoices" },
  { key: "ageing", label: "Ageing" },
] as const;

const STATE_TONE: Record<InvoiceState, "neutral" | "info" | "warn" | "bad" | "ok"> = {
  DRAFT: "neutral",
  RAISED: "info",
  SENT: "info",
  PART_PAID: "warn",
  PAID: "ok",
  DISPUTED: "bad",
  WRITTEN_OFF: "bad",
};

/**
 * Invoicing a vendor, from the queue to what is late.
 *
 * The queue is grouped per vendor because that is how an invoice is actually
 * raised: vendors settle in batches, and an invoice per placement is an invoice
 * nobody pays.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; state?: string }> }) {
  const user = await requireUser([...REPORTING_ROLES]);
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab : "queue";
  const canRaise = user.role === "ADMIN" || user.role === "OPS_MANAGER" || user.role === "SUPER_ADMIN";

  const [vendors, invoices, aged, companies] = await Promise.all([
    queueByVendor({ orgId: isStaff(user) ? undefined : user.orgId }),
    invoiceList({ state: sp.state }),
    ageing(),
    db.select().from(schema.billingCompanies).orderBy(asc(schema.billingCompanies.legalName)),
  ]);

  const amounts = (by: Record<string, number>) => (Object.keys(by).length === 0 ? "nothing" : Object.entries(by).map(([c, n]) => fmtMoney(n, c)).join(" + "));
  const readyAltogether = vendors.reduce((n, v) => n + v.ready.length, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="What can be invoiced, what has been, and what is late. An invoice is raised when the milestone the vendor's own terms name has happened and has a date on it, never on a status alone."
      />
      <div className="mb-4 flex gap-6 border-b border-line">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/invoices?tab=${t.key}`} className={cn("-mb-px border-b-2 py-2 font-medium", t.key === tab ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
            {t.key === "queue" && readyAltogether > 0 ? ` (${readyAltogether})` : ""}
          </Link>
        ))}
      </div>

      {companies.length === 0 && (
        <Alert tone="warn" title="No billing company on record">
          An invoice is raised by a company, and its GSTIN and LUT decide the tax. Add one under Billing before raising anything.
        </Alert>
      )}

      {tab === "queue" && (
        <div className="space-y-4">
          {vendors.length === 0 ? (
            <EmptyState title="Nothing to invoice">
              A commission becomes invoiceable once the milestone its vendor pays on has happened: the visa granted, the enrolment confirmed, whatever their terms say.
            </EmptyState>
          ) : (
            vendors.map((v) => {
              const tax = taxFor(
                companies.find((c) => c.isDefault) ?? companies[0] ?? null,
                v.isIndian,
              );
              return (
                <Card key={v.vendorId}>
                  <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: v.colour }}>{v.code}</span>
                    <h2 className="font-semibold">{v.name}</h2>
                    <Chip tone={v.ready.length > 0 ? "ok" : "neutral"}>{v.ready.length} ready</Chip>
                    {v.waiting.length > 0 && <Chip tone="warn">{v.waiting.length} waiting on a milestone</Chip>}
                    {v.unpriced.length > 0 && <Chip tone="bad">{v.unpriced.length} with no amount</Chip>}
                    {canRaise && companies.length > 0 && (
                      <span className="ml-auto">
                        <RaiseInvoice
                          vendorId={v.vendorId}
                          vendorName={v.name}
                          ready={v.ready.map((r) => ({
                            incomeLineId: r.incomeLineId,
                            studentName: r.studentName,
                            branch: r.branch,
                            course: r.course,
                            ackNo: r.ackNo,
                            amount: r.amount,
                            currency: r.currency,
                            readyOn: r.readyOn,
                            payableWhen: r.payableWhen,
                          }))}
                          companies={companies.map((c) => ({ id: c.id, legalName: c.legalName, gstin: c.gstin, lutNumber: c.lutNumber, lutValidUntil: c.lutValidUntil, isDefault: c.isDefault }))}
                          taxNote={`${tax.treatment}. ${tax.note}`}
                        />
                      </span>
                    )}
                  </div>
                  {v.ready.length === 0 ? (
                    <p className="px-4 py-3 text-muted">Nothing of theirs is ready yet.</p>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Student</Th>
                          <Th>Course</Th>
                          <Th>Ready because</Th>
                          <Th className="text-right">Amount</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.ready.map((r) => (
                          <tr key={r.incomeLineId}>
                            <Td>
                              <Link href={`/students/${r.studentId}/income`} className="font-medium text-brand-600 hover:underline">{r.studentName}</Link>
                              <span className="block text-xs text-muted">{r.branch}{r.ackNo ? ` · ${r.ackNo}` : ""}</span>
                            </Td>
                            <Td className="text-xs">
                              {r.course ?? "—"}
                              {r.university && <span className="block text-muted">{r.university}</span>}
                            </Td>
                            <Td className="text-xs">{r.payableWhen} on {r.readyOn ? fmtDate(r.readyOn) : "—"}</Td>
                            <Td className="whitespace-nowrap text-right tabular">{r.amount == null ? <span className="text-muted">Not recorded</span> : fmtMoney(r.amount, r.currency)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                  <div className="px-4 pb-3">
                    <QueueNote unpriced={v.unpriced.length} waiting={v.waiting.length} />
                  </div>
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === "invoices" && (
        <Card>
          <CardHeader
            title={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
            subtitle="Newest first. A number is unique within the financial year and the database enforces it, so two people raising at once cannot land on the same one."
            action={
              <div className="flex flex-wrap gap-1.5">
                <Link href="/admin/invoices?tab=invoices" className={!sp.state ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted"}>
                  All
                </Link>
                {(["SENT", "PART_PAID", "DISPUTED", "PAID"] as InvoiceState[]).map((s) => (
                  <Link key={s} href={`/admin/invoices?tab=invoices&state=${s}`} className={sp.state === s ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted"}>
                    {INVOICE_STATE_LABEL[s]}
                  </Link>
                ))}
              </div>
            }
          />
          {invoices.length === 0 ? (
            <p className="p-4 text-muted">Nothing raised yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Vendor</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">In</Th>
                  <Th className="text-right">Owed</Th>
                  <Th>Where it is</Th>
                  <Th>Due</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link href={`/admin/invoices/${i.id}`} className="font-medium tabular text-brand-600 hover:underline">{i.number}</Link>
                      <span className="block text-xs text-muted">{i.students} student{i.students === 1 ? "" : "s"}</span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: i.vendorColour }}>{i.vendorCode}</span>
                      <span className="ml-2 text-xs">{i.vendor}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular">{fmtMoney(i.total, i.currency)}</Td>
                    <Td className="whitespace-nowrap text-right tabular">{i.received ? fmtMoney(i.received, i.currency) : "—"}</Td>
                    <Td className="whitespace-nowrap text-right tabular">{i.outstanding ? fmtMoney(i.outstanding, i.currency) : "—"}</Td>
                    <Td><Chip tone={STATE_TONE[i.state]}>{INVOICE_STATE_LABEL[i.state]}</Chip></Td>
                    <Td className="whitespace-nowrap text-xs tabular">
                      {i.dueOn ? fmtDate(i.dueOn) : "—"}
                      {i.state !== "PAID" && i.state !== "WRITTEN_OFF" && i.lateDays != null && i.lateDays > 0 && (
                        <span className="block font-medium text-stop-700">{i.lateDays} days late</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "ageing" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="What is owed, by how late it is" subtitle="Paid and written-off invoices are out of it. A disputed one stays in, because it is still money we are owed until somebody agrees otherwise." />
            <Table>
              <thead>
                <tr>
                  <Th>How late</Th>
                  <Th className="text-right">Invoices</Th>
                  <Th className="text-right">Owed</Th>
                </tr>
              </thead>
              <tbody>
                {AGE_ORDER.map((bucket) => {
                  const row = aged.buckets.get(bucket);
                  return (
                    <tr key={bucket}>
                      <Td className={bucket === "LATE_90" || bucket === "LATE_60" ? "font-medium text-stop-700" : undefined}>{AGE_LABEL[bucket]}</Td>
                      <Td className="text-right tabular">{row?.count ?? 0}</Td>
                      <Td className="text-right tabular">{row ? amounts(row.amounts) : "nothing"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {aged.byVendor.length > 0 && (
            <Card>
              <CardHeader title="By vendor" subtitle="Who is slow to pay, from your own invoices rather than an impression." />
              <Table>
                <thead>
                  <tr>
                    <Th>Vendor</Th>
                    <Th className="text-right">Open invoices</Th>
                    <Th className="text-right">Owed</Th>
                    <Th>Worst of them</Th>
                  </tr>
                </thead>
                <tbody>
                  {aged.byVendor.map((v) => (
                    <tr key={v.code}>
                      <Td>
                        <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: v.colour }}>{v.code}</span>
                        <span className="ml-2">{v.vendor}</span>
                      </Td>
                      <Td className="text-right tabular">{v.count}</Td>
                      <Td className="text-right tabular">{amounts(v.amounts)}</Td>
                      <Td>
                        <Chip tone={v.worst === "LATE_90" || v.worst === "LATE_60" ? "bad" : v.worst === "LATE_30" ? "warn" : "neutral"}>{AGE_LABEL[v.worst]}</Chip>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
