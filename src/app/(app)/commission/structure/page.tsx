import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { money } from "@/lib/money";
import { rulesWithScope } from "@/server/commission";
import { commissionVisible } from "@/server/commission-visibility";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar } from "@/components/ui";
import { IconCommission } from "@/components/icons";

export const metadata = { title: "Commission structure" };

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * What the branch earns, rule by rule: the most specific rule wins, so a
 * program's own rule beats its university's, which beats the destination's.
 */
export default async function CommissionStructurePage({ searchParams }: { searchParams: Promise<{ country?: string; q?: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  if (!isStaff(user) && !(await commissionVisible(user))) redirect("/dashboard");
  const sp = await searchParams;
  const countries = await db.select().from(schema.countries).orderBy(asc(schema.countries.name));
  const q = (sp.q ?? "").trim().toLowerCase();
  const country = countries.find((c) => c.code === sp.country);
  // Each rule's destination: its own, or its university's, or its program's university's.
  const where = await db.execute<{ id: string; country: string | null }>(sql`
    select r.id, coalesce(c1.name, c2.name, c3.name) as country
    from commission_rules r
    left join countries c1 on c1.id = r.country_id
    left join universities u2 on u2.id = r.university_id left join countries c2 on c2.id = u2.country_id
    left join programs p3 on p3.id = r.program_id left join universities u3 on u3.id = p3.university_id left join countries c3 on c3.id = u3.country_id`);
  const destination = new Map([...where].map((r) => [r.id, r.country]));
  const scopeRank = (r: { programName: string | null; universityName: string | null }) => (r.programName ? 0 : r.universityName ? 1 : 2);
  const shown = (await rulesWithScope())
    .filter((r) => r.active)
    .filter((r) => !country || destination.get(r.id) === country.name)
    .filter((r) => !q || [r.name, r.universityName, r.programName, destination.get(r.id)].some((x) => x?.toLowerCase().includes(q)))
    .sort((a, b) => (destination.get(a.id) ?? "").localeCompare(destination.get(b.id) ?? "") || scopeRank(a) - scopeRank(b) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/commission" className="text-[13px] font-medium text-brand-600 hover:underline">← Commission</Link>}
        title="Commission structure"
        subtitle="What your branch earns on each placement. Where two rules could apply, the most specific one wins: a program's own rule, then its university's, then the destination's."
      />
      <Toolbar className="mb-3">
        <form className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
          <Input name="q" defaultValue={sp.q} placeholder="University, program or rule" aria-label="Search rules" />
          <Select name="country" aria-label="Destination" defaultValue={sp.country ?? ""}>
            <option value="">Every destination</option>
            {countries.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
          </Select>
          <div className="flex gap-2">
            <LinkButton href="/commission/structure" variant="quiet" size="sm">Clear</LinkButton>
            <Button type="submit" size="sm" variant="secondary">Filter</Button>
          </div>
        </form>
      </Toolbar>
      <Card>
        {shown.length === 0 ? (
          <EmptyState icon={<IconCommission className="size-5" />} title="No commission rules here yet">
            The Overseas team publishes the rules. Ask on the help desk if a university you work with is missing.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[760px]">
            <thead>
              <tr>
                <Th>Applies to</Th>
                <Th>You earn</Th>
                <Th>Intake</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const scope = r.programName ? "Program" : r.universityName ? "University" : "Destination";
                const you =
                  r.basis === "FLAT"
                    ? r.flatAmount != null
                      ? `${money(Math.round((r.flatAmount * r.partnerSharePercent) / 100), r.currency)} per placement`
                      : "Flat amount to be confirmed"
                    : `${round(((r.percentOfTuition ?? 0) * r.partnerSharePercent) / 100)}% of first-year tuition`;
                return (
                  <tr key={r.id}>
                    <Td>
                      <p className="font-medium text-ink">{r.programName ?? r.universityName ?? r.countryName ?? r.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <Chip>{scope}</Chip>
                        {r.programName && r.universityName && <span>{r.universityName}</span>}
                        {destination.get(r.id) && scope !== "Destination" && <span>{destination.get(r.id)}</span>}
                      </p>
                    </Td>
                    <Td>
                      <p className="font-semibold text-emerald-700">{you}</p>
                      <p className="text-xs text-muted">
                        {r.partnerSharePercent}% of {r.basis === "FLAT" ? `a flat ${money(r.flatAmount, r.currency)}` : `${r.percentOfTuition ?? 0}% of first-year tuition`}
                      </p>
                    </Td>
                    <Td className="text-[13px]">{r.intakeYear ? `${r.intakeYear} intakes` : "Every intake"}</Td>
                    <Td className="max-w-xs text-[13px] text-muted">{r.notes ?? ""}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">Commission is earned once the visa is granted and is paid after the institution pays Medcity Overseas. Figures in search are estimates from these rules.</p>
    </>
  );
}
