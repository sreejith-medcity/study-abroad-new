import Link from "next/link";
import { asc, desc, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, intakeLabel } from "@/lib/format";
import { REPORTING_ROLES, isAdmin } from "@/lib/permissions";
import {
  STATUS_LABEL,
  STATUS_TONE,
  commissionBase,
  commissionTotals,
  commissionWhere,
  inr,
  money,
  payoutList,
  readCommissionFilters,
  rulesWithScope,
} from "@/server/commission";
import {
  Alert,
  BarList,
  Button,
  Card,
  CardHeader,
  Chip,
  DataList,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Th,
  Toolbar,
} from "@/components/ui";
import { IconAlert, IconCommission, IconWallet } from "@/components/icons";
import { AccrueForm, AdjustWalletForm, DecidePayoutForm, MoveCommissionForm, RuleForm } from "./forms";
import { toggleRuleAction } from "./actions";

export const metadata = { title: "Commission" };

const TABS = [
  { key: "pipeline", label: "Pipeline" },
  { key: "rules", label: "Rules" },
  { key: "payouts", label: "Payouts" },
  { key: "wallets", label: "Wallets" },
] as const;

export default async function AdminCommissionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Management reads the same numbers; only an admin can move money.
  const user = await requireUser([...REPORTING_ROLES]);
  const canAct = isAdmin(user);
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "pipeline";
  const f = readCommissionFilters(sp);

  const [rows, totals, rules, payouts, orgs, countries, universities, wallets] = await Promise.all([
    commissionBase().where(commissionWhere(user, f)).orderBy(desc(schema.commissions.createdAt)).limit(200),
    commissionTotals(user, f),
    rulesWithScope(),
    payoutList(undefined, 25),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name)),
    db.select({ id: schema.countries.id, name: schema.countries.name, code: schema.countries.code }).from(schema.countries).orderBy(asc(schema.countries.name)),
    db.select({ id: schema.universities.id, name: schema.universities.name }).from(schema.universities).orderBy(asc(schema.universities.name)),
    db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        tier: schema.organizations.tier,
        balance: sql<number>`coalesce((select sum(amount_inr) from wallet_entries w where w.org_id = organizations.id), 0)::int`,
        paidOut: sql<number>`coalesce((select -sum(amount_inr) from wallet_entries w where w.org_id = organizations.id and w.amount_inr < 0), 0)::int`,
      })
      .from(schema.organizations)
      .where(ne(schema.organizations.type, "HQ"))
      .orderBy(asc(schema.organizations.name)),
  ]);

  const pendingPayouts = payouts.filter((p) => p.status === "REQUESTED");
  const owedToPartners = wallets.reduce((n, w) => n + Number(w.balance), 0);
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const tabHref = (key: string) => `/admin/commission?${new URLSearchParams({ ...(f as Record<string, string>), tab: key }).toString()}`;

  return (
    <>
      <PageHeader
        title="Commission and payouts"
        subtitle="What each placement earns, what has been invoiced and received, and what Medcity still owes its partners."
        actions={
          <LinkButton href="/admin/commission?tab=rules" variant="secondary">
            <IconCommission className="size-4" /> Commission rules
          </LinkButton>
        }
        eyebrow={canAct ? undefined : "Read only"}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Expected" tone="brand" icon={<IconCommission className="size-4" />} value={inr(totals.EXPECTED.partner)} href="/admin/commission?status=EXPECTED" />
        <Stat label="Invoiced" tone="info" value={inr(totals.INVOICED.partner)} href="/admin/commission?status=INVOICED" />
        <Stat label="Received, not settled" tone="warn" icon={<IconAlert className="size-4" />} value={inr(totals.RECEIVED.partner)} href="/admin/commission?status=RECEIVED" />
        <Stat label="Owed to partners" tone="stop" icon={<IconWallet className="size-4" />} value={inr(owedToPartners)} href="/admin/commission?tab=wallets" />
      </div>

      {pendingPayouts.length > 0 && tab !== "payouts" && (
        <Alert tone="warn" title={`${pendingPayouts.length} payout request${pendingPayouts.length > 1 ? "s" : ""} waiting`}>
          <Link href="/admin/commission?tab=payouts" className="font-medium underline">Review them</Link>.
        </Alert>
      )}

      <div className="mt-5 mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={
              tab === t.key
                ? "rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white"
                : "rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft hover:border-brand-300 hover:text-brand-700"
            }
          >
            {t.label}
            {t.key === "payouts" && pendingPayouts.length > 0 ? ` (${pendingPayouts.length})` : ""}
          </Link>
        ))}
      </div>

      {tab === "pipeline" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <Toolbar>
              <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
                <input type="hidden" name="tab" value="pipeline" />
                <Input name="q" placeholder="Student or acknowledgement" aria-label="Search" defaultValue={f.q} className="xl:col-span-2" />
                <Select name="status" aria-label="Stage" defaultValue={f.status ?? ""}>
                  <option value="">Any stage</option>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
                <Select name="org" aria-label="Partner" defaultValue={f.org ?? ""}>
                  <option value="">All partners</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </Select>
                <Select name="country" aria-label="Destination" defaultValue={f.country ?? ""}>
                  <option value="">Any destination</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.code}>{c.name}</option>
                  ))}
                </Select>
                <Select name="year" aria-label="Intake year" defaultValue={f.year ?? ""}>
                  <option value="">Any intake</option>
                  {years.map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </Select>
                <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-2">
                  <LinkButton href="/admin/commission" variant="quiet" size="sm">Clear</LinkButton>
                  <Button type="submit" variant="secondary" size="sm">Filter</Button>
                </div>
              </form>
            </Toolbar>

            <Card>
              {rows.length === 0 ? (
                <EmptyState title="No commission recorded" icon={<IconCommission className="size-5" />}>
                  Commission is created when an application reaches a visa or enrolment and a rule matches it.
                </EmptyState>
              ) : (
                <Table tableClassName="min-w-[1180px]">
                  <thead>
                    <tr>
                      <Th>Student</Th>
                      <Th>Partner</Th>
                      <Th>Placement</Th>
                      <Th className="text-right">Gross</Th>
                      <Th className="text-right">Partner share</Th>
                      <Th>Stage</Th>
                      <Th>{canAct ? "Move it on" : ""}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          <Link href={`/students/${r.studentId}/applications?app=${r.applicationId}`} className="font-medium hover:underline">
                            {fullName(r)}
                          </Link>
                          <p className="ack text-xs text-muted">{r.ackNo} · {intakeLabel(r.intakeMonth, r.intakeYear)}</p>
                        </Td>
                        <Td className="text-[13px]">{r.orgName}</Td>
                        <Td>
                          <p className="text-[13px]">{r.universityName}</p>
                          <p className="text-xs text-muted">{r.countryName}{r.ruleName ? ` · ${r.ruleName}` : ""}</p>
                        </Td>
                        <Td className="whitespace-nowrap text-right tabular">{money(r.grossAmount, r.currency)}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <span className="font-semibold tabular">{r.partnerAmountInr ? inr(r.partnerAmountInr) : money(r.partnerAmount, r.currency)}</span>
                          {r.invoiceRef && <p className="text-xs text-muted">{r.invoiceRef}</p>}
                        </Td>
                        <Td>
                          <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                          {r.settledAt && <p className="mt-1 text-xs text-muted">{fmtDate(r.settledAt)}</p>}
                        </Td>
                        <Td>
                          {canAct ? (
                            <MoveCommissionForm
                              commissionId={r.id}
                              status={r.status}
                              suggestedInr={r.partnerAmountInr ?? (r.currency === "INR" ? r.partnerAmount : null)}
                            />
                          ) : (
                            <span className="text-xs text-muted">Read only</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="By stage" subtitle="Partner share in each" />
              <DataList
                rows={Object.entries(STATUS_LABEL).map(([key, label]) => ({
                  label: `${label} (${totals[key].n})`,
                  value: inr(totals[key].partner),
                  href: `/admin/commission?status=${key}`,
                  tone: key === "SETTLED" ? "ok" : key === "WRITTEN_OFF" ? "bad" : undefined,
                }))}
              />
            </Card>
            {canAct && (
              <Card>
                <CardHeader title="Backfill" subtitle="For placements that happened before a rule existed" />
                <div className="p-4 pt-0">
                  <AccrueForm />
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader title="Commission rules" subtitle="The most specific live rule wins: program, then university, then country" />
            {rules.length === 0 ? (
              <EmptyState title="No rules yet">Add one on the right and every new placement will use it.</EmptyState>
            ) : (
              <Table tableClassName="min-w-[720px]">
                <thead>
                  <tr>
                    <Th>Rule</Th>
                    <Th>Applies to</Th>
                    <Th>Medcity earns</Th>
                    <Th>Partner keeps</Th>
                    <Th>Used</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <p className={r.active ? "font-medium" : "text-muted line-through"}>{r.name}</p>
                        {r.notes && <p className="text-xs text-muted">{r.notes}</p>}
                      </Td>
                      <Td className="text-[13px]">
                        {r.programName ?? r.universityName ?? r.countryName ?? "Everything"}
                        <p className="text-xs text-muted">{r.intakeYear ? `${r.intakeYear} intakes` : "Any intake"}</p>
                      </Td>
                      <Td className="whitespace-nowrap text-[13px] tabular">
                        {r.basis === "FLAT" ? money(r.flatAmount, r.currency) : `${r.percentOfTuition}% of tuition`}
                      </Td>
                      <Td className="tabular">{r.partnerSharePercent}%</Td>
                      <Td className="tabular">{r.used}</Td>
                      <Td>
                        {canAct && (
                          <form action={toggleRuleAction}>
                            <input type="hidden" name="ruleId" value={r.id} />
                            <button className="text-xs text-muted hover:text-stop-500">{r.active ? "Switch off" : "Switch on"}</button>
                          </form>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {canAct ? (
            <Card className="h-fit p-4">
              <h2 className="mb-1 font-display text-[15px] font-semibold">Add a rule</h2>
              <p className="mb-3 text-[13px] text-muted">Point it at a country or a university, set what Medcity earns and what the partner keeps.</p>
              <RuleForm countries={countries} universities={universities} />
            </Card>
          ) : (
            <Card className="h-fit p-4">
              <h2 className="font-display text-[15px] font-semibold">Read only</h2>
              <p className="mt-1 text-[13px] text-muted">Management sees the rules and the numbers. Changing them is an admin job.</p>
            </Card>
          )}
        </div>
      )}

      {tab === "payouts" && (
        <Card>
          <CardHeader title="Payout requests" subtitle="Partners asking for their wallet balance" />
          {payouts.length === 0 ? (
            <EmptyState title="No requests" icon={<IconWallet className="size-5" />}>
              A partner with a positive balance can ask for a transfer from their wallet.
            </EmptyState>
          ) : (
            <Table tableClassName="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Partner</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Asked</Th>
                  <Th>Note</Th>
                  <Th>State</Th>
                  <Th>Decide</Th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.orgName}</Td>
                    <Td className="whitespace-nowrap text-right font-semibold tabular">{inr(p.amountInr)}</Td>
                    <Td className="whitespace-nowrap text-[13px] text-muted">{fmtDate(p.createdAt)}</Td>
                    <Td className="text-[13px] text-muted">{p.note ?? "None"}</Td>
                    <Td>
                      <Chip tone={p.status === "PAID" ? "ok" : p.status === "REJECTED" ? "bad" : p.status === "APPROVED" ? "info" : "warn"}>
                        {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                      </Chip>
                      {p.reference && <p className="mt-1 text-xs text-muted">{p.reference}</p>}
                    </Td>
                    <Td>{canAct ? <DecidePayoutForm payoutId={p.id} status={p.status} /> : <span className="text-xs text-muted">Read only</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === "wallets" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader title="Partner wallets" subtitle="What Medcity owes each partner right now" />
            <Table tableClassName="min-w-[560px]">
              <thead>
                <tr>
                  <Th>Partner</Th>
                  <Th>Tier</Th>
                  <Th className="text-right">Balance</Th>
                  <Th className="text-right">Paid out so far</Th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id}>
                    <Td className="font-medium">{w.name}</Td>
                    <Td><Chip tone={w.tier === "PLATINUM" || w.tier === "ELITE" ? "gold" : "neutral"}>{w.tier}</Chip></Td>
                    <Td className="whitespace-nowrap text-right font-semibold tabular">{inr(Number(w.balance))}</Td>
                    <Td className="whitespace-nowrap text-right tabular text-muted">{inr(Number(w.paidOut))}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <div className="space-y-5">
            {canAct && (
              <Card className="p-4">
                <h2 className="mb-1 font-display text-[15px] font-semibold">Post a bonus or adjustment</h2>
                <p className="mb-3 text-[13px] text-muted">Credits a partner&apos;s wallet straight away. Use a negative amount to correct a mistake.</p>
                <AdjustWalletForm orgs={orgs} />
              </Card>
            )}
            <Card>
              <CardHeader title="Where the money sits" subtitle="Balance per partner" />
              <BarList items={wallets.map((w) => ({ label: w.name, value: Number(w.balance) }))} format={inr} empty="No wallets yet." />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
