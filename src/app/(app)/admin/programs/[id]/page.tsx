import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { ProgramEditForm } from "./edit-form";

export const metadata = { title: "Edit program" };

export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser([...ADMIN_ROLES]);
  const { id } = await params;
  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, id), with: { university: { with: { country: true } } } });
  if (!program) notFound();

  const [docs, history] = await Promise.all([
    db.select({ code: schema.documentTypes.code, label: schema.documentTypes.label }).from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder)),
    db
      .select({ id: schema.auditLogs.id, action: schema.auditLogs.action, meta: schema.auditLogs.meta, createdAt: schema.auditLogs.createdAt, actor: schema.users.name })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.actorId, schema.users.id))
      .where(and(eq(schema.auditLogs.entityType, "program"), eq(schema.auditLogs.entityId, id)))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(10),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/programs" className="text-[13px] font-medium text-brand-600 hover:underline">
            ← Programs
          </Link>
        }
        title={program.name}
        subtitle={`${program.university.name}, ${program.university.country.name} · last changed ${fmtDateTime(program.updatedAt)}`}
        actions={<LinkButton variant="secondary" href={`/programs/${program.id}`}>View as partners see it</LinkButton>}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-5">
          <ProgramEditForm program={program} currency={program.university.country.currency} docs={docs} />
        </Card>
        <Card className="self-start">
          <CardHeader title="Changes" subtitle="Most recent first" />
          {history.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">No edits recorded yet.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {history.map((h) => {
                const changed = (h.meta as { changed?: Record<string, unknown> } | null)?.changed;
                return (
                  <li key={h.id} className="px-4 py-2.5">
                    <p className="font-medium">{h.actor ?? "System"}</p>
                    <p className="text-xs text-muted">
                      {fmtDateTime(h.createdAt)} · {changed ? Object.keys(changed).join(", ") : h.action.replace("program.", "")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
