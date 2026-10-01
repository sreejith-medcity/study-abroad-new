import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtMoney, intakeLabel } from "@/lib/format";
import { isStaff, REPORTING_ROLES } from "@/lib/permissions";
import { allRates, departureBoard, leakageReport, unpricedLines } from "@/server/income";
import { DEPARTURE_KINDS, INCOME_LABEL, INCOME_MEANS, PAYER_LABEL } from "@/lib/income";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { RateCardForm } from "@/components/income-forms";
import { DeleteRate } from "./forms";

export const metadata = { title: "Income and rate cards" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "departures", label: "Leaving soon" },
  { key: "leakage", label: "Left on the table" },
  { key: "rates", label: "Rate cards" },
] as const;

/**
 * The money side of income: what each branch charges, who is leaving and has
 * not bought what, and what was left on the table.
 *
 * Nothing on these screens is invented. A kind with no rate card behind it reads
 * "Not recorded" and is counted nowhere, because a branch owner deciding whether
 * to push forex cards needs a real number or none at all.
 */
export default async function IncomeAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser([...REPORTING_ROLES, "PARTNER"]);
  const { tab = "departures" } = await searchParams;
  const scope = isStaff(user) ? undefined : user.orgId;
  const [board, leak, rates, unpriced, branches] = await Promise.all([
    departureBoard({ orgId: scope, withinDays: 240 }),
    leakageReport({ orgId: scope }),
    allRates(),
    unpricedLines(scope),
    isStaff(user)
      ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name))
      : db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, user.orgId)),
  ]);
  const canSetRates = user.role === "ADMIN" || user.role === "OPS_MANAGER" || user.role === "SUPER_ADMIN";

  return (
    <>
      <PageHeader
        title="Income and rate cards"
        subtitle="What a student is worth, what each branch keeps, and what nobody sold. Every figure here was recorded by somebody; nothing is worked out from a rate that does not exist."
      />
      <div className="mb-4 flex gap-6 border-b border-line">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/income?tab=${t.key}`} className={cn("-mb-px border-b-2 py-2 font-medium", t.key === tab ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </div>

      {unpriced.length > 0 && tab !== "rates" && (
        <Alert tone="warn" title={`${unpriced.length} line${unpriced.length === 1 ? "" : "s"} with no amount on them`}>
          {unpriced
            .slice(0, 6)
            .map((u) => `${INCOME_LABEL[u.kind]} for ${u.firstName} ${u.lastName}`)
            .join(", ")}
          {unpriced.length > 6 ? ` and ${unpriced.length - 6} more` : ""}. They are counted in no total until somebody prices them.
        </Alert>
      )}

      {tab === "rates" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              title="What each branch charges, or keeps"
              subtitle="A rate is added rather than edited, so a student priced last season can still be read against the rate that applied then."
            />
            {rates.length === 0 ? (
              <p className="p-4 text-muted">
                Nothing recorded yet. Until a rate exists, every line laid out on a student reads &ldquo;Not recorded&rdquo; and the totals say so rather than guessing.
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>What for</Th>
                    <Th>Branch</Th>
                    <Th className="text-right">Medcity keeps</Th>
                    <Th>Who pays</Th>
                    <Th>Branch share</Th>
                    <Th>From</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rates.map(({ rate, branch, setBy }) => (
                    <tr key={rate.id}>
                      <Td>
                        <span className="font-medium">{INCOME_LABEL[rate.kind]}</span>
                        {rate.note && <p className="mt-0.5 max-w-xs text-xs text-muted">{rate.note}</p>}
                      </Td>
                      <Td className="text-xs">{branch ?? "Every branch"}</Td>
                      <Td className="whitespace-nowrap text-right tabular">
                        {rate.amount != null ? fmtMoney(rate.amount, rate.currency) : rate.percentOfSale != null ? `${rate.percentOfSale}% of the sale` : <span className="text-muted">Not recorded</span>}
                      </Td>
                      <Td className="text-xs">{PAYER_LABEL[rate.payer]}</Td>
                      <Td className="text-xs">{rate.branchSharePercent != null ? `${rate.branchSharePercent}%` : "—"}</Td>
                      <Td className="whitespace-nowrap text-xs tabular">
                        {fmtDate(rate.activeFrom)}
                        {setBy && <span className="block text-muted">{setBy}</span>}
                      </Td>
                      <Td className="text-right">{canSetRates && <DeleteRate rateCardId={rate.id} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {canSetRates ? (
            <Card className="p-4">
              <h2 className="mb-1 font-semibold text-brand-700">Record a rate</h2>
              <p className="mb-3 text-xs text-muted">One kind, one branch (or all of them), from a day. Give a flat amount or a percentage of the sale, not both.</p>
              <RateCardForm branches={branches} />
            </Card>
          ) : (
            <Card className="p-4">
              <p className="text-muted">The Overseas team keeps the rate cards. Ask them to change what your branch charges.</p>
            </Card>
          )}
        </div>
      )}

      {tab === "leakage" && (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="What was left on the table"
              subtitle={`Across ${leak.students} student${leak.students === 1 ? "" : "s"} who are actually going: a visa granted, or already at the departure stage. A shortlist is not a missed sale.`}
            />
            {leak.students === 0 ? (
              <p className="p-4 text-muted">Nobody has a granted visa yet, so there is nothing anybody could have sold.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>What</Th>
                    <Th className="text-right">Booked</Th>
                    <Th className="text-right">Not booked</Th>
                    <Th>How much of it was sold</Th>
                  </tr>
                </thead>
                <tbody>
                  {leak.overall.map((r) => {
                    const share = r.students ? Math.round((r.booked / r.students) * 100) : 0;
                    return (
                      <tr key={r.kind}>
                        <Td>
                          <span className="font-medium">{INCOME_LABEL[r.kind]}</span>
                          <p className="mt-0.5 text-xs text-muted">{INCOME_MEANS[r.kind]}</p>
                        </Td>
                        <Td className="text-right tabular">{r.booked}</Td>
                        <Td className="text-right tabular">{r.missed}</Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-32 overflow-hidden rounded-full bg-surface-2">
                              <div className="h-full rounded-full bg-brand-600" style={{ width: `${share}%` }} />
                            </div>
                            <span className="text-xs tabular text-muted">{share}%</span>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          {leak.byBranch.length > 1 && (
            <Card>
              <CardHeader title="By branch" subtitle="Where the services are not being offered at all." />
              <Table>
                <thead>
                  <tr>
                    <Th>Branch</Th>
                    <Th className="text-right">Leaving</Th>
                    <Th className="text-right">Lines not booked</Th>
                    <Th className="text-right">Per student</Th>
                  </tr>
                </thead>
                <tbody>
                  {leak.byBranch.map((b) => (
                    <tr key={b.branch}>
                      <Td>{b.branch}</Td>
                      <Td className="text-right tabular">{b.students}</Td>
                      <Td className="text-right tabular">{b.missed}</Td>
                      <Td className="text-right tabular">{b.students ? (b.missed / b.students).toFixed(1) : "0"} of {DEPARTURE_KINDS.length}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {tab !== "rates" && tab !== "leakage" && (
        <Card>
          <CardHeader
            title={`Leaving soon (${board.length})`}
            subtitle="Students with a visa, soonest first, and what they have not bought yet. One call each, before they buy it somewhere else."
          />
          {board.length === 0 ? (
            <EmptyState title="Nobody leaving yet">Students appear here once a visa is granted, or once their file reaches the departure stage.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Starts</Th>
                  <Th>Student</Th>
                  <Th>Course</Th>
                  <Th>Booked</Th>
                  <Th>Not booked</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.studentId}>
                    <Td className="whitespace-nowrap text-xs tabular">
                      {intakeLabel(r.intakeMonth, r.intakeYear)}
                      {!r.visaDecided && <span className="block text-[11px] text-muted">no visa recorded</span>}
                    </Td>
                    <Td>
                      <Link href={`/students/${r.studentId}/income`} className="font-medium text-brand-600 hover:underline">{r.name}</Link>
                      <span className="block text-xs text-muted">{r.branch}</span>
                    </Td>
                    <Td className="text-xs">
                      {r.course}
                      <span className="block text-muted">{r.university}</span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {r.booked.length === 0 ? <span className="text-xs text-muted">Nothing</span> : r.booked.map((k) => <Chip key={k} tone="ok">{INCOME_LABEL[k]}</Chip>)}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {r.missing.length === 0 ? <Chip tone="ok">All of it</Chip> : r.missing.map((k) => <Chip key={k} tone="warn">{INCOME_LABEL[k]}</Chip>)}
                      </span>
                    </Td>
                    <Td>
                      <Link href={`/students/${r.studentId}/income`} className="text-[13px] font-medium text-brand-600 hover:underline">The sheet</Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
