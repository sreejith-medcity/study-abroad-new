import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { ProgramEditForm } from "./edit-form";
import { DeadlineForm } from "./deadlines";
import { deleteDeadlineAction } from "./deadline-actions";
import { programDeadlines } from "@/server/deadlines";
import { liveVendors, routesForProgram } from "@/server/vendors";
import { setRouteActiveAction } from "@/server/vendor-actions";
import { PAYABLE_ON, routeApplicationFee, routeOfferTat, routeTerms } from "@/lib/vendors";
import { AddRoute, EditRoute } from "./routes";
import { Chip } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import { deadlineText, intakesText } from "@/lib/catalogue";
import { MONTHS } from "@/lib/format";
import { Button } from "@/components/ui";

export const metadata = { title: "Edit program" };

export default async function EditProgramPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser([...ADMIN_ROLES]);
  const { id } = await params;
  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, id), with: { university: { with: { country: true } } } });
  if (!program) notFound();

  const [docs, history, deadlines] = await Promise.all([
    db.select({ code: schema.documentTypes.code, label: schema.documentTypes.label }).from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder)),
    db
      .select({ id: schema.auditLogs.id, action: schema.auditLogs.action, meta: schema.auditLogs.meta, createdAt: schema.auditLogs.createdAt, actor: schema.users.name })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.actorId, schema.users.id))
      .where(and(eq(schema.auditLogs.entityType, "program"), eq(schema.auditLogs.entityId, id)))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(10),
    programDeadlines(id),
  ]);
  const money = { tuitionPerYear: program.tuitionPerYear, tuitionTotal: program.tuitionTotal, applicationFee: program.applicationFee, offerTatDays: program.offerTatDays, currency: program.university.country.currency };
  const [vendors, routes] = await Promise.all([liveVendors(), routesForProgram(id, money)]);

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
        <div className="space-y-5 self-start">
        <Card>
          <CardHeader title="Routes" subtitle="Who this course can be applied through, and what each pays." />
          {routes.length > 0 && (
            <ul className="divide-y divide-line border-b border-line text-[13px]">
              {routes.map(({ route, vendor, commission }) => {
                const terms = routeTerms(route, vendor);
                return (
                  <li key={route.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-1.5 font-medium">
                          <span className="size-3 rounded-sm" style={{ background: vendor.colour }} aria-hidden="true" />
                          {vendor.code} {vendor.name}
                          {!route.active && <Chip tone="warn">Paused</Chip>}
                        </p>
                        <p className="text-xs text-muted">
                          {commission.known ? `${fmtMoney(commission.amount, commission.currency)} · ${commission.basis}` : `${commission.basis}: ${commission.reason}`}
                        </p>
                        <p className="text-xs text-muted">
                          Paid once {PAYABLE_ON[terms.payableOn]}, within {terms.daysToPay} days
                          {routeOfferTat(route, money) != null ? ` · offer in ${routeOfferTat(route, money)} days` : ""}
                          {routeApplicationFee(route, money) != null ? ` · application fee ${routeApplicationFee(route, money) === 0 ? "none" : fmtMoney(routeApplicationFee(route, money)!, money.currency)}` : ""}
                        </p>
                        {route.extraDocuments && <p className="text-xs text-muted">Asks for: {route.extraDocuments}</p>}
                      </div>
                      <form action={setRouteActiveAction}>
                        <input type="hidden" name="routeId" value={route.id} />
                        <input type="hidden" name="active" value={route.active ? "0" : "1"} />
                        <Button type="submit" variant="quiet" size="sm">{route.active ? "Pause" : "Bring back"}</Button>
                      </form>
                    </div>
                    <EditRoute programId={program.id} vendors={vendors} currency={money.currency} route={{ ...route, payableOn: route.payableOn as string | null }} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="p-4"><AddRoute programId={program.id} vendors={vendors} currency={money.currency} /></div>
        </Card>
        <Card>
          <CardHeader title="Application deadlines" subtitle={`Intakes: ${intakesText(program.intakeMonths)}. Only dates the institution publishes.`} />
          {deadlines.length > 0 && (
            <ul className="divide-y divide-line border-b border-line text-[13px]">
              {deadlines.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                  <div>
                    <p className="font-medium">{MONTHS[d.intakeMonth - 1]} {d.intakeYear} intake</p>
                    <p className="text-xs text-muted">{deadlineText(d.deadline)}{d.note ? ` · ${d.note}` : ""}</p>
                  </div>
                  <form action={deleteDeadlineAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button type="submit" variant="quiet" size="sm" aria-label={`Remove the ${MONTHS[d.intakeMonth - 1]} ${d.intakeYear} deadline`}>Remove</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="p-4"><DeadlineForm programId={program.id} intakeMonths={program.intakeMonths} /></div>
        </Card>
        <Card>
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
      </div>
    </>
  );
}
