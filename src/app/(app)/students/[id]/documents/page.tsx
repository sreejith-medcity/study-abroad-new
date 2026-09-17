import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getStudentForUser } from "@/server/queries";
import { Card, Chip, cn } from "@/components/ui";
import { deleteDocumentAction } from "./actions";
import { UploadForm } from "./upload";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const user = await requireUser(["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"]);
  await getStudentForUser(user, id);
  const canWrite = user.role !== "MANAGEMENT";
  const teamTab = tab === "team";

  const [types, docs, apps] = await Promise.all([
    db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder)),
    db.query.documents.findMany({ where: eq(schema.documents.studentId, id), with: { uploadedBy: { columns: { name: true, deskLabel: true } } }, orderBy: desc(schema.documents.createdAt) }),
    db.query.applications.findMany({ where: eq(schema.applications.studentId, id), with: { status: true, program: { with: { university: true } } } }),
  ]);

  // Mandatory list = union of required documents across the student's open applications.
  const requiredBy = new Map<string, string[]>();
  for (const a of apps) {
    if (a.status.group === "CLOSED") continue;
    for (const code of a.program.requiredDocs) requiredBy.set(code, [...(requiredBy.get(code) ?? []), a.program.university.name]);
  }
  const visibleTypes = types.filter((t) => (teamTab ? t.uploadedBy === "team" : t.uploadedBy !== "team"));
  const mandatory = visibleTypes.filter((t) => requiredBy.has(t.code));
  const additional = visibleTypes.filter((t) => !requiredBy.has(t.code) && docs.some((d) => d.typeCode === t.code));
  const partnerTypes = types.filter((t) => t.uploadedBy !== "team" || user.role === "ADMIN");

  const docsFor = (code: string) => docs.filter((d) => d.typeCode === code);

  return (
    <Card>
      <div className="flex gap-6 border-b border-line px-4" role="tablist">
        <Link href={`/students/${id}/documents`} role="tab" aria-selected={!teamTab} className={cn("-mb-px border-b-2 py-3 font-medium", !teamTab ? "border-brand-600 text-brand-600" : "border-transparent text-muted")}>Your documents</Link>
        <Link href={`/students/${id}/documents?tab=team`} role="tab" aria-selected={teamTab} className={cn("-mb-px border-b-2 py-3 font-medium", teamTab ? "border-brand-600 text-brand-600" : "border-transparent text-muted")}>Medcity Overseas documents</Link>
      </div>

      <div className="space-y-6 p-4">
        {!teamTab && (
          <section>
            <h2 className="mb-1 font-semibold text-brand-700">Mandatory documents</h2>
            <p className="mb-3 text-xs text-muted">Built from the requirements of every open application.</p>
            {mandatory.length === 0 && <p className="text-muted">No applications yet, so nothing is mandatory. Upload documents below any time.</p>}
            <div className="space-y-3">
              {mandatory.map((t) => (
                <DocTypeCard key={t.code} type={t} files={docsFor(t.code)} requiredFor={[...new Set(requiredBy.get(t.code))]} studentId={id} canWrite={canWrite} userId={user.id} role={user.role} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 font-semibold text-brand-700">{teamTab ? "Issued by Medcity Overseas" : "Additional documents"}</h2>
          <div className="space-y-3">
            {(teamTab ? visibleTypes.filter((t) => docsFor(t.code).length || user.role === "ADMIN") : additional).map((t) => (
              <DocTypeCard key={t.code} type={t} files={docsFor(t.code)} studentId={id} canWrite={canWrite && (!teamTab || user.role === "ADMIN")} userId={user.id} role={user.role} />
            ))}
            {teamTab && user.role !== "ADMIN" && !visibleTypes.some((t) => docsFor(t.code).length) && <p className="text-muted">Offer letters, CAS / COE and visa documents will appear here.</p>}
          </div>
          {canWrite && !teamTab && (
            <div className="mt-4 rounded-md border border-dashed border-line p-3">
              <p className="mb-2 font-medium">Upload another document</p>
              <UploadForm studentId={id} types={partnerTypes.filter((t) => t.uploadedBy !== "team")} />
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}

function DocTypeCard({
  type, files, requiredFor, studentId, canWrite, userId, role,
}: {
  type: { code: string; label: string; uploadedBy: string };
  files: { id: string; fileName: string; createdAt: Date; uploadedById: string | null; uploadedBy: { name: string; deskLabel: string | null } | null }[];
  requiredFor?: string[];
  studentId: string; canWrite: boolean; userId: string; role: string;
}) {
  const ok = files.length > 0;
  return (
    <div className={cn("rounded-md border border-l-4 p-3", ok ? "border-line border-l-emerald-600" : "border-dashed border-line border-l-red-500")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {ok ? <Chip tone="ok">✓</Chip> : <Chip tone="bad">Missing</Chip>} {type.label}
            {requiredFor && <span className="text-red-600"> *</span>}
          </p>
          {requiredFor && <p className="text-xs text-muted">Required for: {requiredFor.join(", ")}</p>}
        </div>
        {canWrite && <div className="min-w-0"><UploadForm studentId={studentId} types={[]} defaultType={type.code} compact /></div>}
      </div>
      {ok && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded bg-ground px-2 py-1 text-xs">
              <a href={`/api/documents/${f.id}`} className="text-brand-600 hover:underline">📄 {f.fileName}</a>
              <span className="text-muted">{fmtDateTime(f.createdAt)} · {f.uploadedBy?.deskLabel ?? f.uploadedBy?.name ?? "Student"}</span>
              {canWrite && (role === "ADMIN" || role === "PARTNER" || f.uploadedById === userId) && (
                <form action={deleteDocumentAction}>
                  <input type="hidden" name="documentId" value={f.id} />
                  <button className="text-muted hover:text-red-600" aria-label={`Delete ${f.fileName}`}>✕</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
