import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtMoney, intakeLabel } from "@/lib/format";
import { APP_ROLES, isAdmin, isStaff, isSuperAdmin } from "@/lib/permissions";
import { commissionVisible } from "@/server/commission-visibility";
import { getStudentForUser } from "@/server/queries";
import { incomeSheet } from "@/server/income";
import { INCOME_LABEL, INCOME_MEANS, PAYER_LABEL, STATE_LABEL } from "@/lib/income";
import { Alert, Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";
import { AddLine, LayOutLines, LineActions } from "@/components/income-forms";
import type { IncomeKind } from "@/db/schema";

export const metadata = { title: "Income" };
export const dynamic = "force-dynamic";

const ALL_KINDS = Object.keys(INCOME_LABEL) as IncomeKind[];

/**
 * What one student is worth.
 *
 * Kept per currency rather than converted into rupees: a total built on
 * yesterday's indicative rate is a figure that will not match the bank. Lines
 * with no amount on them are counted nowhere and named, because a sheet that
 * quietly treats unknowns as nought is a sheet somebody will make a decision on.
 */
export default async function StudentIncomePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const canSeeMoney = await commissionVisible(user);
  if (!canSeeMoney) {
    return user.role === "DOCUMENTATION" ? (
      <EmptyState title="Not for the documentation team">
        Checking a document and knowing what the placement pays are kept apart on purpose. Everything you need to check this
        student&rsquo;s paper is on their Documentation tab.
      </EmptyState>
    ) : (
      <EmptyState title="Not for counsellors at this branch">Your branch owner has chosen to keep money off counsellors&rsquo; screens. Ask them if you need it.</EmptyState>
    );
  }
  const canWrite = isAdmin(user) || user.role === "PARTNER";

  const [sheet, apps, vendors] = await Promise.all([
    incomeSheet(id),
    db.query.applications.findMany({
      where: eq(schema.applications.studentId, id),
      with: { program: { columns: { name: true }, with: { university: { columns: { name: true } } } } },
      orderBy: asc(schema.applications.createdAt),
    }),
    db.select({ id: schema.vendors.id, name: schema.vendors.name }).from(schema.vendors).where(eq(schema.vendors.active, true)).orderBy(asc(schema.vendors.name)),
  ]);
  const appOptions = apps.map((a) => ({ id: a.id, label: `${a.ackNo} · ${a.program.university.name}, ${intakeLabel(a.intakeMonth, a.intakeYear)}` }));
  const onFile = new Set(sheet.rows.map((r) => r.row.kind));
  const missing = ALL_KINDS.filter((k) => !onFile.has(k));

  const amounts = (totals: Record<string, number>) =>
    Object.keys(totals).length === 0 ? "Nothing recorded" : Object.entries(totals).map(([c, n]) => fmtMoney(n, c)).join(" + ");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Expected</p>
            <p className="font-semibold">{amounts(sheet.totals.expected)}</p>
            <p className="text-xs text-muted">{sheet.totals.lines} line{sheet.totals.lines === 1 ? "" : "s"} on the sheet</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Received</p>
            <p className="font-semibold">{amounts(sheet.totals.received)}</p>
            <p className="text-xs text-muted">Invoiced {amounts(sheet.totals.invoiced).toLowerCase()}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Still to come in</p>
            <p className="font-semibold">{amounts(sheet.outstanding)}</p>
            {Object.keys(sheet.totals.writtenOff).length > 0 && <p className="text-xs text-stop-700">Written off {amounts(sheet.totals.writtenOff)}</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">The branch&rsquo;s share</p>
            <p className="font-semibold">{amounts(sheet.totals.branchShare)}</p>
            <p className="text-xs text-muted">Only where a share is recorded</p>
          </div>
        </div>
        {canWrite && (
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <AddLine studentId={id} applications={appOptions} vendors={vendors} />
            <LayOutLines studentId={id} missing={missing} />
            <span className="text-xs text-muted">{student.firstName}&rsquo;s sheet. Nothing here is converted into rupees, so every figure matches the bank it came from.</span>
          </div>
        )}
      </Card>

      {sheet.totals.unknown > 0 && (
        <Alert tone="warn" title={`${sheet.totals.unknown} line${sheet.totals.unknown === 1 ? "" : "s"} with no amount on them`}>
          They read &ldquo;Not recorded&rdquo; and are counted in no total. Price them, or mark them not applicable, so the sheet adds up to something somebody can act on.
        </Alert>
      )}

      {sheet.rows.length === 0 ? (
        <EmptyState title="Nothing on the sheet yet">
          {canWrite ? "Lay out the usual lines from your branch's rate card, or add one by hand." : "Nothing has been recorded against this student."}
        </EmptyState>
      ) : (
        <Card>
          <CardHeader title="Every line" subtitle="Commission is read from the placement rather than copied, so this sheet and the commission screen can never disagree." />
          <Table>
            <thead>
              <tr>
                <Th>What for</Th>
                <Th>Who pays</Th>
                <Th className="text-right">Expected</Th>
                <Th className="text-right">Invoiced</Th>
                <Th className="text-right">Received</Th>
                <Th>Where it has got to</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map(({ row, ...read }) => (
                <tr key={row.id} className={row.state === "WRITTEN_OFF" ? "opacity-60" : undefined}>
                  <Td>
                    <span className="font-medium">{INCOME_LABEL[row.kind]}</span>
                    <p className="mt-0.5 max-w-sm text-xs text-muted">{row.note ?? INCOME_MEANS[row.kind]}</p>
                    {read.sourced && <p className="text-xs text-muted">{read.sourced}</p>}
                    {row.ackNo && <p className="text-xs text-muted">{row.ackNo}{row.course ? ` · ${row.course}` : ""}</p>}
                    {row.invoiceNumber && <p className="text-xs text-muted">On invoice {row.invoiceNumber}</p>}
                  </Td>
                  <Td className="text-xs">
                    {/* The road's colour and code, the same as the invoice queue
                        and the application carry, so one line can be followed
                        across the three screens without reading names. */}
                    {row.vendorName ? (
                      <span className="inline-flex items-center gap-1">
                        {row.vendorCode && (
                          <span
                            className="rounded px-1 py-0.5 text-[10px] font-semibold text-white"
                            style={{ backgroundColor: row.vendorColour ?? "#475569" }}
                          >
                            {row.vendorCode}
                          </span>
                        )}
                        {row.vendorName}
                      </span>
                    ) : (
                      (row.providerName ?? PAYER_LABEL[row.payer])
                    )}
                    {row.dueOn && <span className="block text-muted">due {fmtDate(row.dueOn)}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular">{read.expectedAmount == null ? <span className="text-muted">Not recorded</span> : fmtMoney(read.expectedAmount, read.currency)}</Td>
                  <Td className="whitespace-nowrap text-right tabular">{read.invoicedAmount == null ? <span className="text-muted">—</span> : fmtMoney(read.invoicedAmount, read.currency)}</Td>
                  <Td className="whitespace-nowrap text-right tabular">
                    {read.receivedAmount == null ? <span className="text-muted">—</span> : fmtMoney(read.receivedAmount, read.currency)}
                    {row.receivedOn && <span className="block text-xs text-muted">{fmtDate(row.receivedOn)}</span>}
                  </Td>
                  <Td>
                    <Chip tone={read.state === "RECEIVED" ? "ok" : read.state === "WRITTEN_OFF" ? "bad" : read.state === "INVOICED" ? "info" : read.state === "NOT_APPLICABLE" ? "neutral" : "warn"}>
                      {STATE_LABEL[read.state]}
                    </Chip>
                    {row.writtenOffReason && <p className="mt-0.5 max-w-xs text-xs text-stop-700">{row.writtenOffReason}</p>}
                    {row.branchSharePercent != null && <p className="mt-0.5 text-xs text-muted">Branch keeps {row.branchSharePercent}%</p>}
                  </Td>
                  <Td>
                    {canWrite && (
                      <LineActions
                        line={{
                          id: row.id,
                          kind: row.kind,
                          payer: row.payer,
                          currency: row.currency,
                          expectedAmount: row.expectedAmount,
                          invoicedAmount: row.invoicedAmount,
                          receivedAmount: row.receivedAmount,
                          state: row.state,
                          branchSharePercent: row.branchSharePercent,
                          dueOn: row.dueOn,
                          note: row.note,
                        }}
                        studentId={id}
                        applications={appOptions}
                        vendors={vendors}
                        canWriteOff={isSuperAdmin(user)}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!isStaff(user) && <p className="border-t border-line px-4 py-3 text-xs text-muted">Commission lines show what Medcity is owed. Your own share of it is on the Wallet.</p>}
        </Card>
      )}
    </div>
  );
}
