import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { IMPORT_KINDS, isImportKind, type ImportKind } from "@/lib/import-kinds";
import { ADMIN_ROLES, isAdmin } from "@/lib/permissions";
import { Card, CardHeader, PageHeader, cn } from "@/components/ui";
import { ImportPanel } from "./panel";

export const metadata = { title: "Bulk upload" };

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await requireUser(["PARTNER", ...ADMIN_ROLES]);
  const team = isAdmin(user);
  const kinds = (Object.keys(IMPORT_KINDS) as ImportKind[]).filter((k) => team || !IMPORT_KINDS[k].team);
  const { kind: asked } = await searchParams;
  const kind: ImportKind = asked && isImportKind(asked) && kinds.includes(asked) ? asked : kinds[0];
  const spec = IMPORT_KINDS[kind];
  const columns = spec.columns.filter(([c]) => team || c !== "branch");

  return (
    <>
      <PageHeader title="Bulk upload" subtitle={team ? "Upload a CSV or Excel sheet for any branch. Every upload is checked first and recorded in the audit log." : "Upload a CSV or Excel sheet for your branch. Every upload is checked first, and nothing is saved until you confirm."} />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {kinds.map((k) => (
          <Link key={k} href={`/imports?kind=${k}`} role="tab" aria-selected={k === kind} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", k === kind ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:border-brand-300")}>
            {IMPORT_KINDS[k].label}
          </Link>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader title={spec.label} subtitle={spec.intro} />
          <div className="p-4 pt-0">
            <ImportPanel key={kind} kind={kind} />
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader
            title="Columns"
            subtitle="The first row holds these names. Leave out any you do not have."
            action={<a href={`/api/imports/template/${kind}`} className="text-[13px] font-medium text-brand-600 hover:underline">Download the template</a>}
          />
          <dl className="divide-y divide-line text-[13px]">
            {columns.map(([c, d]) => (
              <div key={c} className="px-4 py-2">
                <dt className="font-mono text-xs text-ink">{c}</dt>
                <dd className="text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
