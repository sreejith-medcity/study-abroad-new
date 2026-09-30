import Link from "next/link";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, isAdmin, PROCESSING_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { activeRejectionReasons, overridesFor, rowStanding, stageGate, studentChecklist, studentContext, syncChecklist, typesNotOnList, wholeGate } from "@/server/documentation";
import { OWED_BY_LABEL, SOURCE_LABEL, STAGES, STATE_LABEL, stageLabel, standingText } from "@/lib/journey";
import { Alert, Card, CardHeader, Chip, Table, Td, Th } from "@/components/ui";
import { AddItem, ItemActions, StageMover } from "./client";

export const metadata = { title: "Documentation" };

const VIEWS = [
  { key: "all", label: "All stages" },
  { key: "outstanding", label: "Outstanding only" },
  { key: "student", label: "With the student" },
  { key: "us", label: "With us" },
  { key: "expiring", label: "Expiring" },
  { key: "rejected", label: "Rejected" },
] as const;

export default async function DocumentationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; stage?: string }> }) {
  const { id } = await params;
  const { view = "all", stage: stageFilter } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const canWrite = user.role !== "MANAGEMENT";
  const canProcess = (PROCESSING_ROLES as readonly string[]).includes(user.role);

  // A file opened for the first time has nothing on its list yet: build it now,
  // so nobody has to press a button to see what the student owes.
  const held = await db.$count(schema.checklistItems, eq(schema.checklistItems.studentId, id));
  if (held === 0 && canWrite) await syncChecklist(id);

  const [rows, ctx, reasons, spare, overrides] = await Promise.all([
    studentChecklist(id),
    studentContext(id),
    activeRejectionReasons(),
    typesNotOnList(id),
    overridesFor(id),
  ]);
  const whole = wholeGate(rows, ctx.courseStart);
  const here = stageGate(rows, student.journeyStage, ctx.courseStart);
  const lastChased = rows.reduce<Date | null>((latest, r) => (r.lastChasedAt && (!latest || r.lastChasedAt > latest) ? r.lastChasedAt : latest), null);

  const withStanding = rows.map((r) => ({ row: r, ...rowStanding(r, ctx.courseStart) }));
  const shown = withStanding.filter(({ row, standing }) => {
    if (stageFilter && row.stage !== stageFilter) return false;
    switch (view) {
      case "outstanding":
        return standing === "OUTSTANDING" || standing === "EXPIRED";
      case "student":
        return (standing === "OUTSTANDING" || standing === "EXPIRED") && row.owedBy === "STUDENT";
      case "us":
        return (standing === "OUTSTANDING" || standing === "EXPIRED") && row.owedBy !== "STUDENT";
      case "expiring":
        return standing === "EXPIRING" || standing === "EXPIRED";
      case "rejected":
        return row.state === "REJECTED";
      default:
        return true;
    }
  });

  const href = (next: { view?: string; stage?: string }) => {
    const sp = new URLSearchParams();
    const v = next.view ?? view;
    const s = next.stage === "" ? "" : (next.stage ?? stageFilter ?? "");
    if (v && v !== "all") sp.set("view", v);
    if (s) sp.set("stage", s);
    const q = sp.toString();
    return `/students/${id}/documentation${q ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Stage</p>
            <p className="font-semibold">{stageLabel(student.journeyStage)}</p>
            <p className="text-xs text-muted">{student.stageEnteredAt ? `Entered ${fmtDate(student.stageEnteredAt)}` : "Entered date not recorded"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Gate</p>
            <p className="font-semibold">{here.clear ? "Clear" : `${here.missing.length} of ${here.total} outstanding`}</p>
            <p className="text-xs text-muted">{whole.withStudent} with the student, {whole.withUs} with us</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Expiring</p>
            {whole.expiring.length === 0 ? (
              <p className="font-semibold">Nothing</p>
            ) : (
              <>
                <p className="font-semibold">{whole.expiring[0].label}{whole.expiring[0].expiresInDays != null ? ` in ${whole.expiring[0].expiresInDays} days` : ""}</p>
                <p className="text-xs text-muted">{ctx.courseStart ? `Measured against ${fmtDate(ctx.courseStart)}, the course start` : "No course start on record, so measured against today"}</p>
              </>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Last chased</p>
            <p className="font-semibold">{lastChased ? fmtDate(lastChased) : "Never"}</p>
            <p className="text-xs text-muted">{rows.length} documents on the list</p>
          </div>
        </div>
        {canWrite && (
          <div className="mt-4 border-t border-line pt-3">
            <StageMover studentId={id} stage={student.journeyStage} canOverride={isAdmin(user)} missing={here.missing.map((m) => m.label)} />
          </div>
        )}
      </Card>

      {!here.clear && (
        <Alert tone="warn" title={`${stageLabel(student.journeyStage)} is not clear`}>
          Still needed: {here.missing.map((m) => `${m.label} (${m.why.toLowerCase()})`).join(", ")}.
        </Alert>
      )}
      {overrides.length > 0 && (
        <Alert tone="info" title="Let through with a reason">
          {overrides.map((o) => (
            <p key={o.id} className="text-[13px]">
              {stageLabel(o.stage)}: {o.reason} — {o.actor?.name ?? "somebody"}, {fmtDate(o.createdAt)}. Missing at the time: {o.missing.join(", ") || "nothing recorded"}.
            </p>
          ))}
        </Alert>
      )}

      <Card>
        <CardHeader
          title="The documentation list"
          subtitle="Built from the stage, the destination, the route, the university and anything added for this student. A document asked for twice is asked for once."
        />
        <div className="flex flex-wrap gap-2 border-b border-line px-4 pb-3">
          {VIEWS.map((v) => (
            <Link key={v.key} href={href({ view: v.key })} className={v.key === view ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}>
              {v.label}
            </Link>
          ))}
          <span className="mx-1 w-px bg-line" aria-hidden="true" />
          <Link href={href({ stage: "" })} className={!stageFilter ? "rounded-full bg-ink px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}>
            Every stage
          </Link>
          {STAGES.map((s) => (
            <Link key={s.value} href={href({ stage: s.value })} className={stageFilter === s.value ? "rounded-full bg-ink px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"} title={s.blurb}>
              {s.number}. {s.label}
            </Link>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="p-4 text-muted">Nothing on this list yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Stage</Th>
                <Th>Asked by</Th>
                <Th>Owed by</Th>
                <Th>Due</Th>
                <Th>Valid to</Th>
                <Th>State</Th>
                <Th className="text-right">Version</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ row, standing, expiresInDays }) => (
                <tr key={row.id} className={standing === "EXPIRED" ? "bg-red-50/60" : undefined}>
                  <Td>
                    <span className={row.required ? "font-medium" : undefined}>{row.label}</span>
                    {!row.required && <span className="ml-2 text-xs text-muted">Not required</span>}
                    {(row.requirementGuidance || row.guidance) && <p className="mt-0.5 max-w-md text-xs text-muted">{row.requirementGuidance ?? row.guidance}</p>}
                    {row.note && <p className="mt-0.5 text-xs text-muted">Added for this student: {row.note}</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{stageLabel(row.stage)}</Td>
                  <Td className="text-xs">{row.sourceLabel ?? SOURCE_LABEL[row.source]}</Td>
                  <Td className="text-xs">{OWED_BY_LABEL[row.owedBy]}</Td>
                  <Td className="whitespace-nowrap text-xs tabular">{row.dueOn ? fmtDate(row.dueOn) : "—"}</Td>
                  <Td className="whitespace-nowrap text-xs tabular">
                    {row.validTo ? fmtDate(row.validTo) : "—"}
                    {expiresInDays != null && standing !== "DONE" && standing !== "SKIPPED" && row.validTo && (
                      <span className="block text-[11px] text-muted">{expiresInDays < 0 ? "Out of date" : `${expiresInDays} days left`}</span>
                    )}
                  </Td>
                  <Td>
                    <StateChip state={row.state} standing={standing} courseStart={ctx.courseStart} />
                    {row.state === "REJECTED" && <p className="mt-0.5 max-w-xs text-xs text-red-700">{row.reasonLabel ?? "Sent back"}{row.reason ? `: ${row.reason}` : ""}</p>}
                    {row.state === "NOT_NEEDED" && row.reason && <p className="mt-0.5 max-w-xs text-xs text-muted">{row.reason}</p>}
                    {row.state === "ASKED" && row.askedAt && <p className="mt-0.5 text-xs text-muted">{fmtDate(row.askedAt)} on {row.askedChannel ?? "the portal"}{row.chaseCount > 0 ? `, chased ${row.chaseCount} time${row.chaseCount === 1 ? "" : "s"}` : ""}</p>}
                    {row.state === "IN_REVIEW" && row.claimedByName && <p className="mt-0.5 text-xs text-muted">With {row.claimedByName}</p>}
                  </Td>
                  <Td className="text-right text-xs tabular">{row.version > 0 ? `v${row.version}` : "—"}</Td>
                  <Td>
                    {canWrite && (
                      <ItemActions
                        item={{
                          id: row.id,
                          studentId: id,
                          label: row.label,
                          state: row.state,
                          typeCode: row.typeCode,
                          source: row.source,
                          version: row.version,
                          validityMonths: row.validityMonths,
                          issuedOn: row.issuedOn,
                          guidance: row.requirementGuidance ?? row.guidance,
                          fileName: row.fileName,
                          documentId: row.documentId,
                          claimedById: row.claimedById,
                          claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
                        }}
                        reasons={reasons.map((r) => ({ code: r.code, label: r.label }))}
                        canProcess={canProcess}
                        userId={user.id}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canWrite && (
        <Card className="p-4">
          <h2 className="mb-1 font-semibold text-brand-700">Add a document for this student alone</h2>
          <p className="mb-3 text-xs text-muted">A gap explanation, a refusal letter, a name-change affidavit. The reason stays on the row, so the next person reading the file knows why it is there.</p>
          <AddItem studentId={id} types={spare} stage={student.journeyStage} />
        </Card>
      )}
    </div>
  );
}

function StateChip({ state, standing, courseStart }: { state: schema.ChecklistState; standing: string; courseStart: Date | null }) {
  if (standing === "EXPIRED") return <Chip tone="bad">{standingText("EXPIRED", courseStart)}</Chip>;
  if (standing === "EXPIRING") return <Chip tone="warn">Expiring</Chip>;
  const tone = state === "ACCEPTED" ? "ok" : state === "REJECTED" ? "bad" : state === "IN_REVIEW" || state === "UPLOADED" ? "info" : state === "NOT_NEEDED" ? "neutral" : "warn";
  return <Chip tone={tone}>{STATE_LABEL[state]}</Chip>;
}

export const dynamic = "force-dynamic";
