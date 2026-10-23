import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getStudentForUser } from "@/server/queries";
import { Alert, Button, Card, Chip, cn } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { deleteDocumentAction, restoreRemovedAction, restoreVersionAction, shareDocumentAction } from "./actions";
import { UploadForm } from "./upload";
import { APP_ROLES, isAdmin, issuesTeamDocuments, worksStudentFiles } from "@/lib/permissions";
import { documentFamilies, versionDay, versionLine, type DocumentFamily } from "@/lib/document-versions";
import { mayRestoreDocuments } from "@/server/document-versions";

export const metadata = { title: "Documents" };

type Person = { name: string; deskLabel: string | null; role: string };

/** How a person is named beside a file: the desk they sit at, or the student. */
const personLabel = (u: Person) => (u.role === "STUDENT" ? "the student" : (u.deskLabel ?? u.name));

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; restored?: string; putBack?: string }> }) {
  const { id } = await params;
  const { tab, restored, putBack } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  await getStudentForUser(user, id);
  const canWrite = worksStudentFiles(user);
  // The desk puts up what Medcity Overseas issues: the offer letter, the CAS or
  // COE, the visa grant. It was an admin-only tab, which left the documentation
  // team reading it and waiting for somebody else.
  const canIssue = issuesTeamDocuments(user);
  const teamTab = tab === "team";
  // Who may bring back an earlier version or a removed file: the people who
  // decide documents.
  const canRestore = await mayRestoreDocuments(user);

  const [types, docs, apps] = await Promise.all([
    db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder)),
    // Every version and every removed file, so each document can be shown with
    // its history. Only the current versions are listed as the student's files.
    db.query.documents.findMany({
      where: eq(schema.documents.studentId, id),
      with: {
        uploadedBy: { columns: { name: true, deskLabel: true, role: true } },
        supersededBy: { columns: { name: true, deskLabel: true, role: true } },
        removedBy: { columns: { name: true, deskLabel: true, role: true } },
      },
      orderBy: desc(schema.documents.createdAt),
    }),
    db.query.applications.findMany({ where: eq(schema.applications.studentId, id), with: { status: true, program: { with: { university: true } } } }),
  ]);

  // Mandatory list = union of required documents across the student's open applications.
  const requiredBy = new Map<string, string[]>();
  for (const a of apps) {
    if (a.status.group === "CLOSED") continue;
    for (const code of a.program.requiredDocs) requiredBy.set(code, [...(requiredBy.get(code) ?? []), a.program.university.name]);
  }
  const visibleTypes = types.filter((t) => (teamTab ? t.uploadedBy === "team" : t.uploadedBy !== "team"));
  // One entry per document, shown by its current version. A replaced file is
  // in that entry's history, not a second file of the same kind.
  const families = documentFamilies(docs).filter((f) => f.current);
  const docsFor = (code: string) => families.filter((f) => f.current!.typeCode === code);
  const mandatory = visibleTypes.filter((t) => requiredBy.has(t.code));
  const additional = visibleTypes.filter((t) => !requiredBy.has(t.code) && docsFor(t.code).length > 0);
  const partnerTypes = types.filter((t) => t.uploadedBy !== "team" || canIssue);

  // Names for the version lines, from the people already loaded with the rows.
  const names = new Map<string, string>();
  for (const d of docs) {
    if (d.uploadedById && d.uploadedBy) names.set(d.uploadedById, personLabel(d.uploadedBy));
    if (d.supersededById && d.supersededBy) names.set(d.supersededById, personLabel(d.supersededBy));
    if (d.removedById && d.removedBy) names.set(d.removedById, personLabel(d.removedBy));
  }
  const typeOf = new Map(types.map((t) => [t.code, t]));
  const onThisTab = (code: string | null) => (typeOf.get(code ?? "")?.uploadedBy === "team") === teamTab;
  const removed = docs.filter((d) => d.removedAt && onThisTab(d.typeCode)).sort((a, b) => b.removedAt!.getTime() - a.removedAt!.getTime());

  // What a restore just did, said here because the button that did it has
  // moved or gone. Worked out from the record, never from text in the link.
  const backDoc = docs.find((d) => d.id === (restored ?? putBack));
  const backNote = backDoc
    ? restored
      ? `${backDoc.fileName} is the current version again.`
      : backDoc.supersededAt
        ? `${backDoc.fileName} is back, as an earlier version.`
        : `${backDoc.fileName} is back on the file.`
    : null;

  return (
    <Card>
      {backNote && (
        <div className="px-4 pt-4">
          <Alert tone="ok">{backNote}</Alert>
        </div>
      )}
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
                <DocTypeCard key={t.code} type={t} families={docsFor(t.code)} names={names} requiredFor={[...new Set(requiredBy.get(t.code))]} studentId={id} canWrite={canWrite} userId={user.id} role={user.role} canProcess={isAdmin(user)} canIssue={canIssue} canRestore={canRestore} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 font-semibold text-brand-700">{teamTab ? "Issued by Medcity Overseas" : "Additional documents"}</h2>
          <div className="space-y-3">
            {(teamTab ? visibleTypes.filter((t) => docsFor(t.code).length || canIssue) : additional).map((t) => (
              <DocTypeCard key={t.code} type={t} families={docsFor(t.code)} names={names} studentId={id} canWrite={canWrite && (!teamTab || canIssue)} userId={user.id} role={user.role} canProcess={isAdmin(user)} canIssue={canIssue} canRestore={canRestore} />
            ))}
            {teamTab && !canIssue && !visibleTypes.some((t) => docsFor(t.code).length) && <p className="text-muted">Offer letters, CAS / COE and visa documents will appear here.</p>}
          </div>
          {canWrite && !teamTab && (
            <div className="mt-4 rounded-md border border-dashed border-line p-3">
              <p className="mb-2 font-medium">Upload another document</p>
              <UploadForm studentId={id} types={partnerTypes.filter((t) => t.uploadedBy !== "team")} />
            </div>
          )}
        </section>

        {canRestore && removed.length > 0 && (
          <section data-removed-documents>
            <details>
              <summary className="cursor-pointer font-semibold text-brand-700">Removed files ({removed.length})</summary>
              <p className="mt-1 text-xs text-muted">Taken off this student&apos;s record. The files are kept, so anything removed by mistake can be put back.</p>
              <ul className="mt-2 space-y-2">
                {removed.map((d) => (
                  <li key={d.id} data-removed-id={d.id} className="flex flex-wrap items-center gap-2 rounded bg-ground px-2 py-1.5 text-xs">
                    <a href={`/api/documents/${d.id}`} className="text-brand-600 hover:underline">📄 {d.label ?? d.fileName}</a>
                    <span className="text-muted">
                      {typeOf.get(d.typeCode ?? "")?.label ?? "Document"} · removed {versionDay(d.removedAt!)}
                      {d.removedById && names.get(d.removedById) ? ` by ${names.get(d.removedById)}` : ""}
                    </span>
                    <ActionForm action={restoreRemovedAction} hideSubmit className="space-y-1">
                      <input type="hidden" name="documentId" value={d.id} />
                      <Button type="submit" variant="secondary" size="sm" aria-label={`Put back ${d.fileName}`}>Put back</Button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}
      </div>
    </Card>
  );
}

type Row = {
  id: string;
  fileName: string;
  label: string | null;
  typeCode: string | null;
  createdAt: Date;
  uploadedById: string | null;
  sharedWithStudent: boolean;
  replacesId: string | null;
  supersededAt: Date | null;
  supersededById: string | null;
  removedAt: Date | null;
  uploadedBy: Person | null;
};

function DocTypeCard({
  type, families, names, requiredFor, studentId, canWrite, userId, role, canProcess, canIssue, canRestore,
}: {
  type: { code: string; label: string; uploadedBy: string; guidance: string | null; sampleStorageKey: string | null };
  families: DocumentFamily<Row>[];
  names: Map<string, string>;
  requiredFor?: string[];
  studentId: string; canWrite: boolean; userId: string; role: string; canProcess: boolean; canIssue: boolean; canRestore: boolean;
}) {
  const ok = families.length > 0;
  // The same rule the action applies, so no cross is offered on a file this
  // person cannot actually remove.
  const mayRemove = (uploadedById: string | null) =>
    canProcess ||
    (type.uploadedBy === "team" ? canIssue : uploadedById === userId || role === "PARTNER");
  // Replacing keeps the old file, so it is open to whoever may upload this kind
  // of document at all; the desk can always bring the old one back.
  const mayReplace = canWrite && (type.uploadedBy !== "team" || canIssue);
  const uploader = (f: Row) => (f.uploadedBy ? personLabel(f.uploadedBy) : null);
  return (
    <div className={cn("rounded-md border border-l-4 p-3", ok ? "border-line border-l-emerald-600" : "border-dashed border-line border-l-red-500")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {ok ? <Chip tone="ok">✓</Chip> : <Chip tone="bad">Missing</Chip>} {type.label}
            {requiredFor && <span className="text-stop-500"> *</span>}
          </p>
          {requiredFor && <p className="text-xs text-muted">Required for: {requiredFor.join(", ")}</p>}
          {type.guidance && <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-soft">{type.guidance}</p>}
          {type.sampleStorageKey && (
            <a href={`/api/document-samples/${type.code}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">See a sample</a>
          )}
        </div>
        {canWrite && <div className="min-w-0"><UploadForm studentId={studentId} types={[]} defaultType={type.code} compact /></div>}
      </div>
      {ok && (
        <ul className="mt-2 space-y-2">
          {families.map((fam) => {
            const f = fam.current!;
            const line = versionLine(fam, (uid) => (uid ? (names.get(uid) ?? null) : null), uploader);
            return (
              <li key={f.id} data-document-id={f.id} className="rounded bg-ground px-2 py-1.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`/api/documents/${f.id}`} className="text-brand-600 hover:underline">📄 {f.label ?? f.fileName}</a>
                  <span className="text-muted">{fmtDateTime(f.createdAt)} · {f.uploadedBy?.role === "STUDENT" ? "From the student" : f.uploadedBy?.deskLabel ?? f.uploadedBy?.name ?? "Student"}</span>
                  {f.uploadedBy?.role !== "STUDENT" &&
                    (canWrite ? (
                      <form action={shareDocumentAction}>
                        <input type="hidden" name="documentId" value={f.id} />
                        <button className={cn("rounded px-1.5 py-0.5 font-medium", f.sharedWithStudent ? "bg-good-50 text-good-700" : "text-brand-600 hover:underline")} aria-label={f.sharedWithStudent ? `Stop sharing ${f.fileName}` : `Share ${f.fileName} with the student`}>
                          {f.sharedWithStudent ? "Shared with student ✓" : "Share with student"}
                        </button>
                      </form>
                    ) : (
                      f.sharedWithStudent && <span className="text-good-700">Shared with student</span>
                    ))}
                  {canWrite && mayRemove(f.uploadedById) && (
                    <form action={deleteDocumentAction}>
                      <input type="hidden" name="documentId" value={f.id} />
                      <button className="text-muted hover:text-stop-500" aria-label={`Delete ${f.fileName}`}>✕</button>
                    </form>
                  )}
                </div>
                {line && <p className="mt-0.5 text-muted" data-version-line>{line}</p>}
                {(mayReplace || fam.earlier.length > 0) && (
                  <div className="mt-1 flex flex-wrap items-start gap-x-4 gap-y-1">
                    {mayReplace && (
                      <details>
                        <summary className="cursor-pointer font-medium text-brand-600" aria-label={`Replace ${f.fileName}`}>Replace</summary>
                        <div className="mt-1">
                          <UploadForm studentId={studentId} types={[]} defaultType={f.typeCode ?? "OTHER"} compact replacesId={f.id} fileLabel={`Replacement for ${f.fileName}`} />
                        </div>
                      </details>
                    )}
                    {fam.earlier.length > 0 && (
                      <details data-earlier-versions>
                        <summary className="cursor-pointer font-medium text-brand-600">Earlier versions ({fam.earlier.length})</summary>
                        <ul className="mt-1 space-y-1">
                          {fam.earlier.map((v) => (
                            <li key={v.id} data-version-id={v.id} className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">Version {v.version}</span>
                              <a href={`/api/documents/${v.id}`} className="text-brand-600 hover:underline">{v.label ?? v.fileName}</a>
                              <span className="text-muted">{fmtDateTime(v.createdAt)} · {uploader(v) ?? "Unknown"}</span>
                              {canRestore && (
                                <ActionForm action={restoreVersionAction} hideSubmit className="space-y-1">
                                  <input type="hidden" name="documentId" value={v.id} />
                                  <Button type="submit" variant="secondary" size="sm" aria-label={`Make version ${v.version} of ${type.label} current`}>Make current</Button>
                                </ActionForm>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
