import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { listRequirements } from "@/server/documentation";
import { OWED_BY_LABEL, SOURCE_LABEL, STAGES, stageLabel } from "@/lib/journey";
import { Card, CardHeader, Chip, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { DocumentTypeForm } from "./form";
import { ReasonForm, ReasonToggle, RequirementForm, RequirementRowActions } from "./requirements";

export const metadata = { title: "Documents and requirements" };

const TABS = [
  { key: "requirements", label: "Stage requirements" },
  { key: "types", label: "Document types" },
  { key: "reasons", label: "Reasons for sending back" },
] as const;

/**
 * Everything the documentation module is built on: what each of the nine stages
 * asks for, the guidance and samples for each document, and the words the team
 * uses when a document goes back.
 */
export default async function DocumentsAdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser([...PROCESSING_ROLES]);
  const { tab = "requirements" } = await searchParams;
  const types = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  const withSample = types.filter((t) => t.sampleStorageKey).length;

  return (
    <>
      <PageHeader
        title="Documents and requirements"
        subtitle="The nine stage lists, what each destination, route and university adds, and the guidance beside each document."
      />
      <div className="mb-4 flex gap-6 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/documents?tab=${t.key}`}
            className={cn("-mb-px border-b-2 py-2 font-medium", t.key === tab ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "types" && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted">{types.length} types · {withSample} with a sample. A sample must not carry a real person&rsquo;s details: use a blanked or made-up one.</p>
          {types.map((t) => (
            <Card key={t.code} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{t.label}</h2>
                <Chip>{t.uploadedBy === "team" ? "Uploaded by the team" : "Uploaded by the partner or student"}</Chip>
                {t.sampleStorageKey && <Chip tone="ok">Sample</Chip>}
              </div>
              <DocumentTypeForm code={t.code} label={t.label} guidance={t.guidance} sampleFileName={t.sampleFileName} />
            </Card>
          ))}
        </div>
      )}

      {tab === "reasons" && <Reasons />}
      {tab !== "types" && tab !== "reasons" && <Requirements types={types.map((t) => ({ code: t.code, label: t.label }))} />}
    </>
  );
}

async function Reasons() {
  const reasons = await db.select().from(schema.rejectionReasons).orderBy(asc(schema.rejectionReasons.sortOrder), asc(schema.rejectionReasons.label));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="The reasons a document goes back" subtitle="Whatever is picked here is what the student reads, word for word. Retiring one leaves the files that already carry it untouched." />
        {reasons.length === 0 ? (
          <p className="p-4 text-muted">No reasons recorded yet. A rejection cannot be saved without one, so add the team&rsquo;s own list first.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Reason</Th>
                <Th>In Malayalam</Th>
                <Th>State</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.code}>
                  <Td>{r.label}</Td>
                  <Td className="text-xs text-muted">{r.labelMl ?? "Not translated"}</Td>
                  <Td>{r.active ? <Chip tone="ok">In use</Chip> : <Chip>Retired</Chip>}</Td>
                  <Td className="text-right"><ReasonToggle code={r.code} active={r.active} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card className="p-4">
        <h2 className="mb-3 font-semibold text-brand-700">Add a reason</h2>
        <ReasonForm />
      </Card>
    </div>
  );
}

async function Requirements({ types }: { types: { code: string; label: string }[] }) {
  const [rows, countries, vendors, universities] = await Promise.all([
    listRequirements(),
    db.select({ id: schema.countries.id, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name)),
    db.select({ id: schema.vendors.id, name: schema.vendors.name }).from(schema.vendors).where(eq(schema.vendors.active, true)).orderBy(asc(schema.vendors.name)),
    db.select({ id: schema.universities.id, name: schema.universities.name }).from(schema.universities).orderBy(asc(schema.universities.name)).limit(500),
  ]);
  const mapped = rows.map((r) => ({
    id: r.req.id,
    stage: r.req.stage,
    typeCode: r.req.typeCode,
    label: r.label,
    source: r.req.source,
    scope: r.country ?? r.vendor ?? r.program ?? r.university ?? null,
    countryId: r.req.countryId,
    vendorId: r.req.vendorId,
    universityId: r.req.universityId,
    programId: r.req.programId,
    required: r.req.required,
    owedBy: r.req.owedBy,
    validityMonths: r.req.validityMonths,
    guidance: r.req.guidance,
    guidanceMl: r.req.guidanceMl,
    sortOrder: r.req.sortOrder,
    active: r.req.active,
  }));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-1 font-semibold text-brand-700">Add a requirement</h2>
        <p className="mb-3 text-xs text-muted">
          A student&rsquo;s list is the stage lists, plus what their destinations, routes and universities add. A document asked for twice is asked for once, and the most specific row is the one whose rule is shown.
        </p>
        <RequirementForm types={types} countries={countries} vendors={vendors} universities={universities} />
      </Card>

      {STAGES.map((stage) => {
        const here = mapped.filter((r) => r.stage === stage.value);
        return (
          <Card key={stage.value}>
            <CardHeader title={`${stage.number}. ${stage.label}`} subtitle={stage.blurb} action={<Chip>{here.length} recorded</Chip>} />
            {here.length === 0 ? (
              <p className="p-4 text-muted">
                {stage.value === "SHORTLIST"
                  ? "Nothing new is asked for here. The gate is that the profile is complete for the destinations shortlisted."
                  : "Nothing recorded for this stage yet."}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th>Asked by</Th>
                    <Th>Owed by</Th>
                    <Th>Good for</Th>
                    <Th>Holds the stage</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {here.map((r) => (
                    <tr key={r.id} className={r.active ? undefined : "opacity-60"}>
                      <Td>
                        {r.label}
                        {r.guidance && <p className="mt-0.5 max-w-lg text-xs text-muted">{r.guidance}</p>}
                        {!r.active && <Chip className="mt-1">Paused</Chip>}
                      </Td>
                      <Td className="text-xs">{r.scope ?? SOURCE_LABEL[r.source]}</Td>
                      <Td className="text-xs">{OWED_BY_LABEL[r.owedBy]}</Td>
                      <Td className="text-xs">{r.validityMonths ? `${r.validityMonths} months from its date` : "Its own expiry"}</Td>
                      <Td className="text-xs">{r.required ? "Yes" : "No"}</Td>
                      <Td>
                        <RequirementRowActions row={r} types={types} countries={countries} vendors={vendors} universities={universities} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        );
      })}
      <p className="text-xs text-muted">
        Changing a requirement changes every student&rsquo;s list as their file is opened, and never touches a document that has already been sent, accepted or refused. {stageLabel("PROFILE")} onwards, nothing is deleted.
      </p>
    </div>
  );
}
