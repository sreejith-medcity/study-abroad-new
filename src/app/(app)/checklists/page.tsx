import Link from "next/link";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin } from "@/lib/permissions";
import { STAGES } from "@/lib/journey";
import type { Pathway } from "@/db/schema";
import { Card, CardHeader, Chip, PageHeader, cn } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Document checklists" };

const JOURNEYS: { key: Pathway; label: string; blurb: string }[] = [
  { key: "DEGREE", label: "Study abroad", blurb: "A degree, diploma or foundation course abroad" },
  { key: "AUSBILDUNG", label: "Ausbildung", blurb: "Vocational training with a German employer" },
  { key: "NURSING", label: "Nurse registration", blurb: "Nursing registration abroad: the NMC and the like, and NCLEX-RN files opened before NCLEX-RN had its own journey" },
  { key: "NCLEX", label: "NCLEX-RN", blurb: "USA nurse licensing: CGFNS, the state board and the NCLEX-RN exam" },
  { key: "FSJ", label: "FSJ (Germany)", blurb: "Freiwilliges Soziales Jahr: the volunteer service, on the FSJ / BFD written process" },
  { key: "BFD", label: "BFD (Germany)", blurb: "Bundesfreiwilligendienst: the federal volunteer service, on the FSJ / BFD written process" },
  { key: "WEITERBILDUNG", label: "Weiterbildung", blurb: "Further training in Germany and the nurse recognition adaptation. A starting list until the written guide arrives" },
  { key: "CCM", label: "CCM", blurb: "A starting list until the written guide arrives" },
];

/**
 * What a candidate has to bring, for each journey, on one page that prints.
 *
 * Read from the same requirements every student's Documentation tab is built
 * from, so the sheet handed to somebody walking into a branch and the list on
 * their file once they register cannot say different things. Every journey
 * also gets what all of them share, the passport and the school marksheets;
 * what a particular destination adds on top is listed under it.
 */
export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const journey = JOURNEYS.find((j) => j.key === sp.for) ?? JOURNEYS[0];
  const r = schema.documentRequirements;
  const t = schema.documentTypes;
  const rows = await db
    .select({
      id: r.id,
      stage: r.stage,
      source: r.source,
      required: r.required,
      guidance: r.guidance,
      validityMonths: r.validityMonths,
      label: t.label,
      country: schema.countries.name,
    })
    .from(r)
    .innerJoin(t, eq(t.code, r.typeCode))
    .leftJoin(schema.countries, eq(schema.countries.id, r.countryId))
    .where(and(eq(r.active, true), inArray(r.source, ["ALWAYS", "DESTINATION"]), or(isNull(r.pathway), eq(r.pathway, journey.key))))
    .orderBy(asc(r.stage), asc(r.sortOrder), asc(t.sortOrder));

  const always = rows.filter((x) => x.source === "ALWAYS");
  const byDestination = rows.filter((x) => x.source === "DESTINATION");
  const destinations = [...new Set(byDestination.map((x) => x.country ?? ""))].filter(Boolean).sort();

  return (
    <>
      <PageHeader
        title="Document checklists"
        subtitle="What a candidate brings, by journey. The same lists every student's Documentation tab is built from."
        actions={
          <>
            {isAdmin(user) && (
              <Link href="/admin/documents" className="text-sm font-medium text-brand-600 hover:underline" data-print="hide">
                Edit the lists
              </Link>
            )}
            <PrintButton label="Print this checklist" />
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Journey" data-print="hide">
        {JOURNEYS.map((j) => (
          <Link
            key={j.key}
            href={`/checklists?for=${j.key}`}
            role="tab"
            aria-selected={j.key === journey.key}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium",
              j.key === journey.key ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:bg-surface-2",
            )}
          >
            {j.label}
          </Link>
        ))}
      </div>

      <Card data-checklist={journey.key}>
        <CardHeader
          title={`${journey.label}: documents to bring`}
          subtitle={`${journey.blurb}. Required ones hold the file at their stage; the rest are asked for where they apply.`}
        />
        <div className="divide-y divide-line">
          {STAGES.map((st) => {
            const here = always.filter((x) => x.stage === st.value);
            if (!here.length) return null;
            return (
              <section key={st.value} className="px-4 py-3 [break-inside:avoid]">
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted">
                  {st.number}. {st.label}
                </h3>
                <ul className="space-y-1.5">
                  {here.map((x) => (
                    <li key={x.id} className="flex items-start gap-2.5" data-checklist-item>
                      <span className="mt-0.5 size-4 shrink-0 rounded border border-line-strong" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{x.label}</span>{" "}
                        {x.required ? <Chip tone="brand">Required</Chip> : <span className="text-xs text-muted">where it applies</span>}
                        {x.validityMonths && <span className="ml-1 text-xs text-muted">good for {x.validityMonths} months</span>}
                        {x.guidance && <span className="block text-xs text-muted">{x.guidance}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Card>

      {destinations.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="What a destination adds" subtitle="On top of the list above, for students going there." />
          <div className="grid gap-x-6 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
            {destinations.map((d) => (
              <section key={d} className="px-4 py-3 [break-inside:avoid]">
                <h3 className="mb-2 font-semibold text-ink">{d}</h3>
                <ul className="space-y-1.5">
                  {byDestination
                    .filter((x) => x.country === d)
                    .map((x) => (
                      <li key={x.id} className="flex items-start gap-2.5">
                        <span className="mt-0.5 size-4 shrink-0 rounded border border-line-strong" aria-hidden="true" />
                        <span>
                          <span className="font-medium">{x.label}</span> {!x.required && <span className="text-xs text-muted">where it applies</span>}
                          {x.guidance && <span className="block text-xs text-muted">{x.guidance}</span>}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
