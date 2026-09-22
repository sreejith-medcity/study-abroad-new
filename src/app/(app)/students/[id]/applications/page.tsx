import Link from "next/link";
import { RichText } from "@/components/rich-text";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { summarise } from "@/lib/checks";
import { fmtDate, fmtDateTime, fmtMoney, intakeLabel } from "@/lib/format";
import { APP_ROLES, isAdmin, isDocumentationTeam, isStaff } from "@/lib/permissions";
import { checkApplication, statusesFor } from "@/server/applications";
import { getStudentForUser } from "@/server/queries";
import { Button, Card, CardHeader, Chip, DataList, EmptyState, Input, Select, StatusBadge, cn } from "@/components/ui";
import { confirmationLabel, dayText, daysUntil, deadlineText, tuitionText } from "@/lib/catalogue";
import { markFeePaidAction, setDeadlineDoneAction, setDocumentTypeAction, setPriorityAction } from "./actions";
import { PRIORITY_LABEL } from "@/lib/priority";
import { ApplyForm, CommentComposer, DeadlineAddForm, OfferVisaForm, StatusForm, type OfferVisaValues } from "./client";
import { DEADLINE_LABEL } from "@/lib/deadline-types";

export const metadata = { title: "Applications" };

export default async function StudentApplicationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ app?: string; tab?: string; ch?: string; program?: string; q?: string; country?: string; pw?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const canWrite = user.role !== "MANAGEMENT";

  const apps = await db.query.applications.findMany({
    where: eq(schema.applications.studentId, id),
    with: { status: true, program: { with: { university: { with: { country: true } } } }, officer: { columns: { name: true, phone: true, deskLabel: true } } },
    orderBy: desc(schema.applications.createdAt),
  });

  const tab = sp.tab === "apply" || sp.program || apps.length === 0 ? "apply" : "applied";
  const selected = apps.find((a) => a.id === sp.app) ?? apps[0];
  const channel = sp.ch === "STUDENT" ? "STUDENT" : "TEAM";

  return (
    <Card>
      <div className="flex justify-center gap-8 border-b border-line" role="tablist">
        <TabLink href={`/students/${id}/applications?tab=apply`} active={tab === "apply"}>Apply to programs</TabLink>
        <TabLink href={`/students/${id}/applications`} active={tab === "applied"}>Applied programs ({apps.length})</TabLink>
      </div>

      {tab === "apply" ? (
        <div className="mx-auto max-w-2xl p-5">
          {canWrite ? <ApplyPanel studentId={id} pathway={sp.pw ?? student.preferredPathway ?? ""} preselectProgramId={sp.program} q={sp.q ?? ""} country={sp.country ?? ""} /> : <EmptyState title="Read-only access" />}
        </div>
      ) : selected ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="space-y-3">
            {apps.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/students/${id}/applications?app=${a.id}`}
                  aria-current={a.id === selected.id ? "true" : undefined}
                  className={cn("block overflow-hidden rounded-md border bg-white", a.id === selected.id ? "border-brand-600 ring-2 ring-brand-100" : "border-line hover:border-brand-500")}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
                    <StatusBadge group={a.status.group} label={a.status.label} />
                    {a.priority === "HIGH" && <Chip tone="bad">High priority</Chip>}
                    {a.priority === "LOW" && <Chip>Low priority</Chip>}
                  </div>
                  <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 px-3 py-2 text-xs">
                    <dt className="text-muted">Ack. no</dt><dd className="tabular">{a.ackNo}</dd>
                    <dt className="text-muted">Date</dt><dd>{fmtDateTime(a.createdAt)}</dd>
                    <dt className="text-muted">Course</dt><dd>{a.program.name}</dd>
                    <dt className="text-muted">University</dt><dd>{a.program.university.name}</dd>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          <ApplicationDetail appId={selected.id} studentId={id} channel={channel} canProcess={isAdmin(user)} canCheck={isAdmin(user) || isDocumentationTeam(user)} staff={isStaff(user)} canWrite={canWrite} whatsapp={student.whatsappOptIn && student.org.studentWhatsappMessages} />
        </div>
      ) : null}
    </Card>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} role="tab" aria-selected={active} className={cn("-mb-px border-b-2 px-2 py-3 font-medium", active ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}>
      {children}
    </Link>
  );
}

/**
 * The catalogue is too large to send to the browser whole, so the program list
 * is searched here: the student's shortlist first, then up to 50 matches for
 * the filters. Any live program can be applied to; where no intakes are
 * recorded the counsellor picks the one the student is aiming for.
 */
async function ApplyPanel({ studentId, pathway, preselectProgramId, q, country }: { studentId: string; pathway: string; preselectProgramId?: string; q: string; country: string }) {
  const { programs: p, universities: u, countries: c } = schema;
  const openable = eq(p.status, "LIVE");
  const columns = {
    id: p.id, name: p.name, pathway: p.pathway, intakeMonths: p.intakeMonths, campus: p.campus,
    tuitionPerYear: p.tuitionPerYear, tuitionTotal: p.tuitionTotal,
    minIelts: p.minIelts, minPte: p.minPte, minOetGrade: p.minOetGrade, minGermanLevel: p.minGermanLevel, maxBacklogs: p.maxBacklogs, moiAccepted: p.moiAccepted, minToefl: p.minToefl, minDuolingo: p.minDuolingo, minAcademicPercent: p.minAcademicPercent,
    university: u.name, country: c.name, currency: c.currency,
  };
  const base = () => db.select(columns).from(p).innerJoin(u, eq(p.universityId, u.id)).innerJoin(c, eq(u.countryId, c.id));
  const [matches, picked, preselected, countries] = await Promise.all([
    base()
      .where(and(
        openable,
        pathway ? eq(p.pathway, pathway as schema.Pathway) : undefined,
        country ? eq(c.code, country) : undefined,
        q ? or(ilike(p.name, `%${q}%`), ilike(u.name, `%${q}%`)) : undefined,
      ))
      .orderBy(asc(p.name))
      .limit(50),
    base().innerJoin(schema.shortlists, eq(schema.shortlists.programId, p.id)).where(and(openable, eq(schema.shortlists.studentId, studentId))).orderBy(asc(p.name)),
    preselectProgramId ? base().where(and(openable, eq(p.id, preselectProgramId))) : Promise.resolve([]),
    db.selectDistinct({ code: c.code, name: c.name }).from(c).innerJoin(u, eq(u.countryId, c.id)).innerJoin(p, eq(p.universityId, u.id)).where(openable).orderBy(asc(c.name)),
  ]);
  const seen = new Set<string>();
  const rows = [...preselected, ...picked, ...matches].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const shortlisted = new Set(picked.map((r) => r.id));
  const deadlineRows = rows.length
    ? await db
        .select({ programId: schema.programDeadlines.programId, month: schema.programDeadlines.intakeMonth, year: schema.programDeadlines.intakeYear, deadline: schema.programDeadlines.deadline })
        .from(schema.programDeadlines)
        .where(inArray(schema.programDeadlines.programId, rows.map((r) => r.id)))
    : [];
  const programs = rows.map((r) => ({
    id: r.id,
    name: r.name,
    university: r.campus ? `${r.university} (${r.campus})` : r.university,
    country: r.country,
    pathway: r.pathway,
    intakeMonths: r.intakeMonths,
    shortlisted: shortlisted.has(r.id),
    tuition: tuitionText(r.tuitionPerYear, r.tuitionTotal, r.currency),
    deadlines: Object.fromEntries(deadlineRows.filter((d) => d.programId === r.id).map((d) => [`${d.year}-${d.month}`, d.deadline])),
    requirements: [
      r.minIelts && `IELTS ${r.minIelts}`,
      r.minPte && `PTE ${r.minPte}`,
      r.minToefl != null && `TOEFL ${r.minToefl}`,
      r.minDuolingo != null && `Duolingo ${r.minDuolingo}`,
      r.minAcademicPercent != null && `marks ${r.minAcademicPercent}%+`,
      r.minOetGrade && `OET ${r.minOetGrade}`,
      r.minGermanLevel && `German ${r.minGermanLevel}`,
      r.maxBacklogs != null && `backlogs ≤ ${r.maxBacklogs}`,
      r.moiAccepted && "MOI accepted",
    ].filter(Boolean).join(", "),
  }));
  return (
    <>
      <h2 className="mb-3 text-base font-semibold">Start a new application</h2>
      <form className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input type="hidden" name="tab" value="apply" />
        <Input name="q" defaultValue={q} placeholder="Program or university" aria-label="Search programs" />
        <Select name="country" defaultValue={country} aria-label="Country">
          <option value="">All countries</option>
          {countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </Select>
        <Select name="pw" defaultValue={pathway} aria-label="Pathway">
          <option value="">All pathways</option>
          <option value="DEGREE">University degree</option>
          <option value="AUSBILDUNG">Ausbildung (Germany)</option>
          <option value="NURSING">Nurse registration</option>
        </Select>
        <Button type="submit" variant="secondary" size="sm">Find</Button>
      </form>
      <ApplyForm studentId={studentId} programs={programs} preselectProgramId={preselectProgramId} limited={matches.length === 50} />
    </>
  );
}

async function ApplicationDetail({ appId, studentId, channel, canProcess, canCheck, staff, canWrite, whatsapp }: { appId: string; studentId: string; channel: "TEAM" | "STUDENT"; canProcess: boolean; canCheck: boolean; staff: boolean; canWrite: boolean; whatsapp: boolean }) {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, appId),
    with: {
      status: true,
      program: { with: { university: { with: { country: true } } } },
      officer: { columns: { name: true, phone: true, deskLabel: true } },
      history: { with: { toStatus: true, changedBy: { columns: { name: true } } }, orderBy: desc(schema.statusHistory.createdAt) },
    },
  });
  if (!app) return null;

  const comments = await db.query.comments.findMany({
    where: and(eq(schema.comments.applicationId, appId), eq(schema.comments.channel, channel)),
    with: { author: { columns: { name: true, role: true, deskLabel: true } }, attachments: true },
    orderBy: asc(schema.comments.createdAt),
  });
  const docTypes = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  const checks = await checkApplication(appId);
  const { blockers, warnings } = summarise(checks);
  const statuses = canProcess ? await statusesFor(app.status.pathway) : [];
  const currency = app.program.university.country.currency;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted">{fmtDateTime(app.createdAt)}</p>
            <p className="text-lg font-semibold tabular">{app.ackNo}</p>
            <p className="text-base">{app.program.name}</p>
            <p className="text-muted">{app.program.university.name}, {app.program.university.country.name} · {intakeLabel(app.intakeMonth, app.intakeYear)}</p>
          </div>
          <div className="text-right">
            <StatusBadge group={app.status.group} label={app.status.label} className="text-sm" />
            <p className="mt-1 text-xs text-muted">since {fmtDate(app.statusChangedAt)}</p>
            {app.deadline && <p className="mt-1 text-xs text-red-600">Deadline {fmtDate(app.deadline)}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <span className="text-muted">Application fee:</span>
          {app.feeStatus === "NOT_APPLICABLE" ? <Chip tone="ok">No application fee</Chip> : app.feeStatus === "PAID" ? <Chip tone="ok">Paid{app.program.applicationFee != null ? ` ${fmtMoney(app.program.applicationFee, currency)}` : ""}</Chip> : app.program.applicationFee == null ? <Chip tone="warn">Fee to confirm</Chip> : <Chip tone="warn">Due {fmtMoney(app.program.applicationFee, currency)}</Chip>}
          {app.feeStatus === "DUE" && canProcess && (
            <form action={markFeePaidAction}><input type="hidden" name="applicationId" value={app.id} /><Button variant="quiet" className="py-1 text-xs">Mark paid</Button></form>
          )}
          {canWrite ? (
            <form action={setPriorityAction} className="flex items-center gap-1.5">
              <input type="hidden" name="applicationId" value={app.id} />
              <Select name="priority" aria-label="Priority" defaultValue={app.priority} className="w-40 py-1 text-xs">
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Button variant="quiet" className="py-1 text-xs">Set</Button>
            </form>
          ) : (
            <Chip tone={app.priority === "HIGH" ? "bad" : undefined}>{PRIORITY_LABEL[app.priority]}</Chip>
          )}
          <span className="ml-auto text-muted">Officer: {app.officer ? `${app.officer.name}${app.officer.phone ? ` · ${app.officer.phone}` : ""}` : "not assigned yet"}</span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Pre-submission check</h3>
            {blockers > 0 ? <Chip tone="bad">{blockers} blocker{blockers > 1 ? "s" : ""}</Chip> : warnings > 0 ? <Chip tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Chip> : <Chip tone="ok">Ready</Chip>}
          </div>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <Chip tone={c.severity === "blocker" ? "bad" : c.severity === "warning" ? "warn" : "ok"} className="shrink-0">{c.severity === "blocker" ? "Blocker" : c.severity === "warning" ? "Warning" : "Pass"}</Chip>
                <span>{c.message}</span>
              </li>
            ))}
            {checks.length === 0 && <li className="text-muted">No rules configured for this program.</li>}
          </ul>
          {staff && canCheck && <Link href={`/admin/applications/${app.id}/check`} className="mt-3 inline-block text-brand-600 hover:underline">Open check and ask partner</Link>}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Status</h3>
          {canProcess && canWrite && (
            <div className="mb-3 border-b border-line pb-3">
              <StatusForm applicationId={app.id} currentId={app.statusId} statuses={statuses.map((s) => ({ id: s.id, label: s.label, requiresReason: s.requiresReason, isMilestone: s.isMilestone }))} />
            </div>
          )}
          <ol className="space-y-2">
            {app.history.map((h) => (
              <li key={h.id} className="flex items-start gap-2">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                <div>
                  <p>{h.toStatus.label}</p>
                  <p className="text-xs text-muted">{fmtDateTime(h.createdAt)} · {h.changedBy.name}{h.reason ? ` · ${h.reason}` : ""}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <DeadlinesPanel applicationId={app.id} canEdit={canCheck && canWrite} canTick={canWrite} />

      <OfferVisaCard app={app} currency={currency} canEdit={canCheck && canWrite} />

      <Card>
        <div className="flex items-center gap-6 border-b border-line px-4">
          <h3 className="py-3 font-semibold text-brand-600">Comments</h3>
          <div className="ml-auto flex gap-4" role="tablist">
            <TabLink href={`/students/${studentId}/applications?app=${app.id}&ch=TEAM`} active={channel === "TEAM"}>Team</TabLink>
            <TabLink href={`/students/${studentId}/applications?app=${app.id}&ch=STUDENT`} active={channel === "STUDENT"}>Student{whatsapp ? " · WhatsApp" : ""}</TabLink>
          </div>
        </div>
        <div className="space-y-4 p-4">
          {canWrite && <CommentComposer applicationId={app.id} channel={channel} whatsapp={whatsapp} />}
          <ul className="space-y-3">
            {[...comments].reverse().map((c) => {
              const mine = c.author && (c.author.role === "PARTNER" || c.author.role === "COUNSELLOR");
              const fromStudent = c.source === "WHATSAPP";
              const system = c.source === "SYSTEM";
              return (
                <li key={c.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-lg px-3 py-2", system ? "bg-ground text-muted" : fromStudent ? "bg-emerald-50" : mine ? "bg-slate-100" : "bg-brand-50")}>
                    <p className="text-xs font-semibold">
                      {fromStudent ? c.authorLabel ?? "Student (WhatsApp)" : c.author ? c.author.deskLabel ?? c.author.name : "System"}
                      {fromStudent && <span className="ml-1 font-normal text-emerald-700">via WhatsApp</span>}
                    </p>
                    <RichText text={c.body} />
                    {c.attachments.map((d) => (
                      <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2">
                        <a href={`/api/documents/${d.id}`} className="rounded bg-white px-2 py-1 text-xs text-brand-600 hover:underline">📎 {d.fileName}</a>
                        {canWrite && (!d.typeCode || d.typeCode === "OTHER") && (
                          <form action={setDocumentTypeAction} className="flex items-center gap-1">
                            <input type="hidden" name="documentId" value={d.id} />
                            <Select name="typeCode" aria-label="File as" className="py-1 text-xs" defaultValue="">
                              <option value="" disabled>File as…</option>
                              {docTypes.filter((t) => t.code !== "OTHER").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                            </Select>
                            <Button variant="secondary" className="px-2 py-1 text-xs">File</Button>
                          </form>
                        )}
                      </div>
                    ))}
                    <p className="mt-1 text-[11px] text-muted">{fmtDateTime(c.createdAt)}{c.deliveredAt ? " · delivered on WhatsApp" : ""}</p>
                  </div>
                </li>
              );
            })}
            {comments.length === 0 && <li className="py-4 text-center text-muted">No {channel === "TEAM" ? "team" : "student"} messages yet.</li>}
          </ul>
        </div>
      </Card>
    </div>
  );
}

type OfferVisaApp = OfferVisaValues & { id: string; program: { university: { country: { code: string } } } };

/** Offer, deposit, CAS / I-20 / CoE and visa: the team edits, partners read. */
function OfferVisaCard({ app, currency, canEdit }: { app: OfferVisaApp; currency: string; canEdit: boolean }) {
  const confirmation = confirmationLabel(app.program.university.country.code);
  const day = (d: string | null) => (d ? dayText(d) : null);
  const rows = [
    { label: "Offer", value: app.offerType ? `${app.offerType === "UNCONDITIONAL" ? "Unconditional" : "Conditional"}${app.offerDate ? `, issued ${day(app.offerDate)}` : ""}` : "No offer yet", tone: app.offerType === "UNCONDITIONAL" ? ("ok" as const) : undefined },
    ...(app.offerAcceptBy ? [{ label: "Accept by", value: deadlineText(app.offerAcceptBy), tone: daysUntil(app.offerAcceptBy) <= 7 ? ("warn" as const) : undefined }] : []),
    ...(app.offerConditions ? [{ label: "Conditions", value: app.offerConditions }] : []),
    { label: "Deposit", value: app.depositPaidOn ? `${fmtMoney(app.depositAmount, currency)} paid ${day(app.depositPaidOn)}` : app.depositAmount != null ? `${fmtMoney(app.depositAmount, currency)}, not paid yet` : "Not recorded" },
    { label: confirmation, value: app.confirmationNumber ? `${app.confirmationNumber}${app.confirmationIssuedOn ? `, issued ${day(app.confirmationIssuedOn)}` : ""}` : "Not issued yet" },
    {
      label: "Visa",
      value: app.visaDecision ? `${app.visaDecision === "GRANTED" ? "Granted" : "Refused"}${app.visaDecisionOn ? ` ${day(app.visaDecisionOn)}` : ""}` : app.visaLodgedOn ? `Lodged ${day(app.visaLodgedOn)}, awaiting decision` : "Not lodged yet",
      tone: app.visaDecision === "GRANTED" ? ("ok" as const) : app.visaDecision === "REFUSED" ? ("bad" as const) : undefined,
    },
  ];
  return (
    <Card>
      <CardHeader title="Offer and visa" subtitle={canEdit ? "Partners see this summary; they are notified when it changes." : "Kept by the Overseas team"} />
      <DataList rows={rows} />
      {canEdit && (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Update offer and visa</summary>
          <div className="mt-3"><OfferVisaForm applicationId={app.id} values={app} currency={currency} confirmation={confirmation} /></div>
        </details>
      )}
    </Card>
  );
}

/** Dated milestones on the application, soonest first; done ones fall to the bottom. */
async function DeadlinesPanel({ applicationId, canEdit, canTick }: { applicationId: string; canEdit: boolean; canTick: boolean }) {
  const d = schema.applicationDeadlines;
  const rows = await db.select().from(d).where(eq(d.applicationId, applicationId)).orderBy(sql`${d.doneAt} is not null`, asc(d.dueOn));
  if (!rows.length && !canEdit) return null;
  return (
    <Card>
      <CardHeader title="Deadlines" subtitle="Payment, CAS request, offer acceptance and the rest, as the institution sets them" />
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-b border-line text-[13px]">
          {rows.map((r) => {
            const left = daysUntil(r.dueOn);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className={cn(r.doneAt && "text-muted line-through")}>
                  <span className="font-medium">{DEADLINE_LABEL[r.type]}</span> · {deadlineText(r.dueOn)}{r.note ? ` · ${r.note}` : ""}
                </div>
                <div className="flex items-center gap-1">
                  {!r.doneAt && left <= 3 && <Chip tone="bad">{left < 0 ? "Overdue" : "Due soon"}</Chip>}
                  {canTick && (
                    <form action={setDeadlineDoneAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <Button type="submit" variant="quiet" size="sm">{r.doneAt ? "Reopen" : "Mark done"}</Button>
                    </form>
                  )}
                  {canEdit && (
                    <form action={setDeadlineDoneAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="remove" value="1" />
                      <Button type="submit" variant="quiet" size="sm">Remove</Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && <div className="p-4"><DeadlineAddForm applicationId={applicationId} /></div>}
    </Card>
  );
}
