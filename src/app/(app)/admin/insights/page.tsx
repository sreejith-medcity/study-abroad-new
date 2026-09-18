import Link from "next/link";
import { asc, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { MONTHS } from "@/lib/format";
import { REPORTING_ROLES } from "@/lib/permissions";
import { SOURCE_LABEL } from "@/server/enquiries";
import { inr } from "@/server/commission";
import { breakdown, enquiryEffectiveness, headline, intakeSpread, rate, readInsightFilters, revenueByCountry, speed } from "@/server/insights";
import {
  BarList,
  Button,
  Card,
  CardHeader,
  Chip,
  DataList,
  EmptyState,
  DateInput,
  LinkButton,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Th,
  Toolbar,
  TrendChart,
} from "@/components/ui";
import { IconApplications, IconCheck, IconClock, IconInsights } from "@/components/icons";

export const metadata = { title: "Insights" };

const DIMENSIONS = [
  { key: "partner", label: "Partner" },
  { key: "country", label: "Destination" },
  { key: "university", label: "University" },
  { key: "pathway", label: "Pathway" },
  { key: "officer", label: "Officer" },
] as const;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...REPORTING_ROLES]);
  const sp = await searchParams;
  const f = readInsightFilters(sp);
  const dimRaw = Array.isArray(sp.dim) ? sp.dim[0] : sp.dim;
  const dim = (DIMENSIONS.find((d) => d.key === dimRaw)?.key ?? "partner") as (typeof DIMENSIONS)[number]["key"];

  const [totals, rows, timing, sources, intakes, revenue, countries, orgs] = await Promise.all([
    headline(user, f),
    breakdown(user, f, dim),
    speed(user, f),
    enquiryEffectiveness(user),
    intakeSpread(user, f),
    revenueByCountry(user, f),
    db.select().from(schema.countries).orderBy(asc(schema.countries.name)),
    db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name)),
  ]);

  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(f as Record<string, string>), dim, ...extra }).toString();
  const exportHref = `/api/insights/export?${qs({ dim })}`;
  const totalRevenue = revenue.reduce((n, r) => n + r.partnerInr, 0);

  return (
    <>
      <PageHeader
        title="Insights"
        subtitle="Where applications come from, how they convert, how long each step takes, and what it earns."
        actions={
          <LinkButton href={exportHref} variant="secondary">
            Export CSV
          </LinkButton>
        }
      />

      <Toolbar className="mb-5">
        <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6 [&>*]:min-w-0">
          <input type="hidden" name="dim" value={dim} />
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 [&>*]:min-w-0">
            <DateInput label="Created from" name="from" defaultValue={f.from} />
            <DateInput label="Created to" name="to" defaultValue={f.to} />
          </div>
          <Select name="country" aria-label="Destination" defaultValue={f.country ?? ""}>
            <option value="">All destinations</option>
            {countries.map((c) => (
              <option key={c.id} value={c.code}>{c.name}</option>
            ))}
          </Select>
          <Select name="pathway" aria-label="Pathway" defaultValue={f.pathway ?? ""}>
            <option value="">All pathways</option>
            <option value="DEGREE">Degree</option>
            <option value="AUSBILDUNG">Ausbildung</option>
            <option value="NURSING">Nurse registration</option>
          </Select>
          <Select name="org" aria-label="Partner" defaultValue={f.org ?? ""}>
            <option value="">All partners</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
          <Select name="year" aria-label="Intake year" defaultValue={f.year ?? ""}>
            <option value="">All intakes</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-6">
            <LinkButton href="/admin/insights" variant="quiet" size="sm">Clear</LinkButton>
            <Button type="submit" variant="secondary" size="sm">Apply</Button>
          </div>
        </form>
      </Toolbar>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Applications" tone="brand" icon={<IconApplications className="size-4" />} value={totals.total} />
        <Stat label="Reached an offer" tone="good" icon={<IconCheck className="size-4" />} value={`${rate(totals.offers, totals.total)}%`} />
        <Stat label="Reached a visa" tone="good" value={`${rate(totals.visas, totals.total)}%`} />
        <Stat label="Median days to offer" tone="info" icon={<IconClock className="size-4" />} value={timing.toOffer ?? "None yet"} />
        <Stat label="Partner earnings" tone="warn" value={inr(totalRevenue)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Conversion"
              subtitle="Same columns, grouped by whatever you pick"
              action={
                <div className="flex flex-wrap gap-1">
                  {DIMENSIONS.map((d) => (
                    <Link
                      key={d.key}
                      href={`/admin/insights?${qs({ dim: d.key })}`}
                      className={
                        dim === d.key
                          ? "rounded-md bg-brand-600 px-2 py-1 text-xs font-medium text-white"
                          : "rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-soft hover:border-brand-300"
                      }
                    >
                      {d.label}
                    </Link>
                  ))}
                </div>
              }
            />
            {rows.length === 0 ? (
              <EmptyState title="Nothing in this range" icon={<IconInsights className="size-5" />}>
                Widen the dates or clear the filters.
              </EmptyState>
            ) : (
              <Table tableClassName="min-w-[760px]">
                <thead>
                  <tr>
                    <Th>{DIMENSIONS.find((d) => d.key === dim)?.label}</Th>
                    <Th>Applications</Th>
                    <Th>Live</Th>
                    <Th>Offers</Th>
                    <Th>Offer rate</Th>
                    <Th>Visas</Th>
                    <Th>Visa rate</Th>
                    <Th>Closed</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <Td className="font-medium">{r.label}</Td>
                      <Td className="tabular">{r.total}</Td>
                      <Td className="tabular">{r.live}</Td>
                      <Td className="tabular">{r.offers}</Td>
                      <Td>
                        <Chip tone={rate(r.offers, r.total) >= 50 ? "ok" : rate(r.offers, r.total) >= 25 ? "warn" : "neutral"}>
                          {rate(r.offers, r.total)}%
                        </Chip>
                      </Td>
                      <Td className="tabular">{r.visas}</Td>
                      <Td className="tabular">{rate(r.visas, r.total)}%</Td>
                      <Td className="tabular text-muted">{r.closed}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Intakes ahead" subtitle="Applications per intake" />
              <TrendChart
                points={intakes.map((i) => ({ label: `${MONTHS[i.month - 1]} ${String(i.year).slice(2)}`, a: i.total }))}
                aLabel="Applications"
              />
            </Card>
            <Card>
              <CardHeader title="Enquiry sources" subtitle="How many became students" />
              {sources.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-muted">No enquiries logged yet.</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Source</Th>
                      <Th>Logged</Th>
                      <Th>Converted</Th>
                      <Th>Rate</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.source}>
                        <Td>{SOURCE_LABEL[s.source]}</Td>
                        <Td className="tabular">{s.total}</Td>
                        <Td className="tabular">{s.converted}</Td>
                        <Td>
                          <Chip tone={rate(s.converted, s.total) >= 30 ? "ok" : "neutral"}>{rate(s.converted, s.total)}%</Chip>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="How long it takes" subtitle="Median days, from the status history" />
            <DataList
              rows={[
                { label: "Application to first offer", value: timing.toOffer ?? "No offers yet" },
                { label: "Application to visa", value: timing.toVisa ?? "No visas yet" },
                { label: "Sitting in the current stage", value: timing.inStage ?? 0 },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Outcomes" subtitle="Across the filters above" />
            <DataList
              rows={[
                { label: "Applications", value: totals.total },
                { label: "Live now", value: totals.live },
                { label: "Reached an offer", value: totals.offers, tone: "ok" },
                { label: "Reached a visa", value: totals.visas, tone: "ok" },
                { label: "Enrolled or deployed", value: totals.enrolled, tone: "ok" },
                { label: "Closed", value: totals.closed, tone: "bad" },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Earnings by destination" subtitle="Partner share, indicative in rupees" />
            <BarList
              items={revenue.map((r) => ({ label: r.label, hint: `${r.placements} placement${r.placements === 1 ? "" : "s"}`, value: r.partnerInr }))}
              tone="gold"
              format={inr}
              empty="No commission recorded yet."
            />
          </Card>
        </div>
      </div>
    </>
  );
}
