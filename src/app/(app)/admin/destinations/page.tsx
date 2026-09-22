import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { dayText } from "@/lib/catalogue";
import { fmtMoney } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { rankLabels } from "@/lib/rankings";
import { Card, CardHeader, Chip, PageHeader } from "@/components/ui";
import { LivingFundsForm, RankingsImportForm } from "./forms";

export const metadata = { title: "Destinations and rankings" };

export default async function DestinationsPage() {
  await requireUser([...ADMIN_ROLES]);
  const countries = await db.select().from(schema.countries).orderBy(asc(schema.countries.name));
  const ranked = await db
    .select({ id: schema.universities.id, name: schema.universities.name, qsRank: schema.universities.qsRank, qsYear: schema.universities.qsYear, theRank: schema.universities.theRank, theYear: schema.universities.theYear })
    .from(schema.universities)
    .where(isNotNull(schema.universities.rankSort))
    .orderBy(asc(schema.universities.rankSort), asc(schema.universities.name))
    .limit(300);
  return (
    <>
      <PageHeader title="Destinations and rankings" subtitle="Figures partners quote to students. Each one keeps its source, so it can be checked when the government or the ranking changes." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader title="Living costs for the student visa" subtitle="What a student must show for the first year, as each government states it. Leave blank where there is no national figure." />
          <ul className="divide-y divide-line">
            {countries.map((c) => (
              <li key={c.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{c.name}</p>
                  {c.visaLivingFunds != null ? (
                    <Chip tone="ok">{fmtMoney(c.visaLivingFunds, c.currency)}{c.visaLivingChecked ? ` · checked ${dayText(c.visaLivingChecked)}` : ""}</Chip>
                  ) : (
                    <Chip>Not recorded</Chip>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Edit</summary>
                  <div className="mt-2"><LivingFundsForm countryId={c.id} currency={c.currency} amount={c.visaLivingFunds} note={c.visaLivingNote} source={c.visaLivingSource} /></div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-5 self-start">
          <Card className="p-4">
            <h2 className="mb-1 font-semibold">University rankings</h2>
            <p className="mb-3 text-[13px] text-muted">From the QS and THE sites themselves, with the edition year. A later file replaces what is there for the universities it lists.</p>
            <RankingsImportForm />
          </Card>
          <Card>
            <CardHeader title="Ranked universities" subtitle={`${ranked.length} with a ranking`} />
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto text-[13px]">
              {ranked.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <Link href={`/universities/${u.id}`} className="hover:underline">{u.name}</Link>
                  <span className="text-xs text-muted">{rankLabels(u).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
