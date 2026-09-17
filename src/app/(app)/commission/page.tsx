import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import {
  STATUS_LABEL,
  STATUS_TONE,
  commissionBase,
  commissionTotals,
  commissionWhere,
  inr,
  money,
  readCommissionFilters,
  walletBalance,
} from "@/server/commission";
import {
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
import { IconCheck, IconClock, IconCommission, IconWallet } from "@/components/icons";

export const metadata = { title: "Commission" };

/** The partner's own statement. Medcity's view of every partner lives under /admin/commission. */
export default async function CommissionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  if (isStaff(user)) {
    const { redirect } = await import("next/navigation");
    redirect("/admin/commission");
  }
  const f = readCommissionFilters(await searchParams);

  const [rows, totals, wallet, countries] = await Promise.all([
    commissionBase().where(commissionWhere(user, f)).orderBy(desc(schema.commissions.createdAt)).limit(200),
    commissionTotals(user),
    walletBalance(user.orgId),
    db.select().from(schema.countries).orderBy(asc(schema.countries.name)),
  ]);

  const inFlight = totals.EXPECTED.partner + totals.INVOICED.partner + totals.RECEIVED.partner;
  const earned = totals.SETTLED.partner;
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];

  return (
    <>
      <PageHeader
        title="Commission"
        subtitle="What each placement earns your branch, from the moment the visa lands to the day it reaches your wallet."
        actions={
          <LinkButton href="/wallet" variant="secondary">
            <IconWallet className="size-4" /> Open wallet
          </LinkButton>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Placements earning" tone="brand" icon={<IconCommission className="size-4" />} value={Object.values(totals).reduce((n, t) => n + t.n, 0)} />
        <Stat label="Still to come" tone="warn" icon={<IconClock className="size-4" />} value={inr(inFlight)} />
        <Stat label="Paid to you" tone="good" icon={<IconCheck className="size-4" />} value={inr(earned)} />
        <Stat label="Wallet balance" tone="info" icon={<IconWallet className="size-4" />} value={inr(wallet.balance)} href="/wallet" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <Toolbar>
            <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
              <Input name="q" placeholder="Student or acknowledgement" aria-label="Search" defaultValue={f.q} className="xl:col-span-2" />
              <Select name="status" aria-label="Stage" defaultValue={f.status ?? ""}>
                <option value="">Any stage</option>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <Select name="year" aria-label="Intake year" defaultValue={f.year ?? ""}>
                <option value="">Any intake</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </Select>
              <Select name="country" aria-label="Destination" defaultValue={f.country ?? ""}>
                <option value="">Any destination</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.code}>{c.name}</option>
                ))}
              </Select>
              <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-3">
                <LinkButton href="/commission" variant="quiet" size="sm">Clear</LinkButton>
                <Button type="submit" variant="secondary" size="sm">Filter</Button>
              </div>
            </form>
          </Toolbar>

          <Card>
            {rows.length === 0 ? (
              <EmptyState title="No commission yet" icon={<IconCommission className="size-5" />}>
                A commission appears here as soon as one of your students reaches a visa or enrolment.
              </EmptyState>
            ) : (
              <Table tableClassName="min-w-[820px]">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Placement</Th>
                    <Th>Intake</Th>
                    <Th className="text-right">Your share</Th>
                    <Th>Stage</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <Link href={`/students/${r.studentId}/applications?app=${r.applicationId}`} className="font-medium hover:underline">
                          {fullName(r)}
                        </Link>
                        <p className="ack text-xs text-muted">{r.ackNo}</p>
                      </Td>
                      <Td>
                        <p className="text-[13px]">{r.universityName}</p>
                        <p className="text-xs text-muted">{r.programName} · {r.countryName}</p>
                      </Td>
                      <Td className="whitespace-nowrap text-[13px]">{intakeLabel(r.intakeMonth, r.intakeYear)}</Td>
                      <Td className="whitespace-nowrap text-right">
                        <p className="font-semibold tabular">{r.partnerAmountInr ? inr(r.partnerAmountInr) : money(r.partnerAmount, r.currency)}</p>
                        <p className="text-xs text-muted">of {money(r.grossAmount, r.currency)}</p>
                      </Td>
                      <Td>
                        <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                        {r.settledAt && <p className="mt-1 text-xs text-muted">{fmtDate(r.settledAt)}</p>}
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
            <CardHeader title="By stage" subtitle="Your share of each" />
            <DataList
              rows={Object.entries(STATUS_LABEL).map(([key, label]) => ({
                label: `${label} (${totals[key].n})`,
                value: inr(totals[key].partner),
                href: `/commission?status=${key}`,
                tone: key === "SETTLED" ? "ok" : key === "WRITTEN_OFF" ? "bad" : undefined,
              }))}
            />
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-[15px] font-semibold">How this works</h2>
            <ol className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
              <li><span className="font-medium text-ink">Expected</span> as soon as your student gets a visa or enrols.</li>
              <li><span className="font-medium text-ink">Invoiced</span> when Medcity bills the institution.</li>
              <li><span className="font-medium text-ink">Received</span> when the institution pays Medcity.</li>
              <li><span className="font-medium text-ink">Paid to you</span> credits your wallet, which you can withdraw.</li>
            </ol>
            <p className="mt-3 text-[13px] text-muted">
              Amounts in another currency are converted to rupees when your share is settled.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
