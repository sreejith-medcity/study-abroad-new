import Link from "next/link";
import { asc, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { dayText } from "@/lib/catalogue";
import { fmtMoney } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { rankLabels } from "@/lib/rankings";
import { Card, CardHeader, Chip, PageHeader } from "@/components/ui";
import { hasGuide } from "@/components/destination-guide";
import { GuideForm, LivingFundsForm, RankingsImportForm, ServiceChargeForm } from "./forms";

export const metadata = { title: "Destinations, service charge and rankings" };

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
      {/* Which destinations Medcity charges the student a service charge for.
          A student going to a ticked country, and every Ausbildung student,
          shows what has been paid and what is still owed, on their file and
          on the placement tracker. */}
      <section id="service-charge" className="mb-5">
        <details className="rounded-xl border border-line bg-surface shadow-card" open={countries.some((c) => c.collectsServiceCharge) ? undefined : true}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
            <span className="font-semibold text-brand-700">Countries that collect a service charge</span>
            <span className="text-sm text-muted">
              {countries.filter((c) => c.collectsServiceCharge).map((c) => c.name).join(", ") || "None ticked yet"}
            </span>
            <span className="ml-auto text-xs text-muted">Show</span>
          </summary>
          <div className="border-t border-line px-4 py-3">
            <p className="mb-3 text-sm text-muted">
              Tick a country and its students show the service charge received and pending. Ausbildung students always do. The usual charge is offered as the
              starting figure on a student&rsquo;s Income tab; leave it empty where there is no single figure.
            </p>
            <ul className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
              {countries.map((c) => (
                <li key={c.id} className="rounded-lg px-2 py-1.5 odd:bg-surface-2/60">
                  <ServiceChargeForm countryId={c.id} name={c.name} on={c.collectsServiceCharge} amount={c.serviceChargeInr} />
                </li>
              ))}
            </ul>
          </div>
        </details>
      </section>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-5">
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
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">Edit</summary>
                  <div className="mt-2"><LivingFundsForm countryId={c.id} currency={c.currency} amount={c.visaLivingFunds} note={c.visaLivingNote} source={c.visaLivingSource} /></div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
        {/* What counsellors read about each country. The MIOC import fills
            these where blank; what is saved here is never overwritten by it. */}
        <Card>
          <CardHeader title="Destination guides" subtitle="Overview, capital, languages, climate, accommodation and the questions students ask. Plain text; line breaks are kept." />
          <ul className="divide-y divide-line">
            {countries.map((c) => (
              <li key={c.id} id={`guide-${c.code}`} className="space-y-2 px-4 py-3" data-guide-country={c.code}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <Link href={`/destinations/${c.code}`} className="hover:underline">{c.name}</Link>
                  </p>
                  {hasGuide(c) ? <Chip tone="ok">{`Guide recorded${c.faqs.length ? ` · ${c.faqs.length} questions` : ""}`}</Chip> : <Chip>Not recorded</Chip>}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">Edit guide</summary>
                  <div className="mt-2">
                    <GuideForm countryId={c.id} guide={c.guide} capital={c.capital} languages={c.languages} climate={c.climate} accommodation={c.accommodation} faqs={c.faqs ?? []} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
        </div>
        <div className="space-y-5 self-start">
          <Card className="p-4">
            <h2 className="mb-1 font-semibold">University rankings</h2>
            <p className="mb-3 text-sm text-muted">From the QS and THE sites themselves, with the edition year. A later file replaces what is there for the universities it lists.</p>
            <RankingsImportForm />
          </Card>
          <Card>
            <CardHeader title="Ranked universities" subtitle={`${ranked.length} with a ranking`} />
            <ul className="max-h-[480px] divide-y divide-line overflow-y-auto text-sm">
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
