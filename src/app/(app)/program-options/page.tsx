import Link from "next/link";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL, tuitionText } from "@/lib/catalogue";
import { fmtDateTime, fullName } from "@/lib/format";
import { OPTIONS_STATUS_LABEL, OPTIONS_STATUS_TONE } from "@/lib/options";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { optionRequestForUser } from "@/server/option-access";
import { addOptionAction, linkStudentAction, removeOptionAction, sendOptionsAction, setArchivedAction } from "@/server/option-requests";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { OptionMessageForm, ShortlistAllForm } from "@/components/option-forms";

export const metadata = { title: "Program options" };

type SP = { id?: string; tab?: string; q?: string; status?: string; pq?: string };

/**
 * Requests on the left, the open one on the right: the partner reads the
 * team's list and acts on it without leaving the page.
 */
export default async function ProgramOptionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const sp = await searchParams;
  const staff = isStaff(user);
  const r = schema.optionRequests;
  const archived = sp.tab === "archived";
  const conds: (SQL | undefined)[] = [eq(r.archived, archived), staff ? undefined : eq(r.orgId, user.orgId)];
  if (sp.q) conds.push(or(ilike(r.studentName, `%${sp.q}%`), ilike(r.requestNo, `%${sp.q}%`)));
  if (sp.status && ["REQUESTED", "OPTIONS_SENT", "APPLIED"].includes(sp.status)) conds.push(eq(r.status, sp.status as "REQUESTED"));
  const list = await db.query.optionRequests.findMany({
    where: and(...conds),
    with: { org: { columns: { name: true } }, requestedBy: { columns: { name: true } }, programs: { columns: { id: true } } },
    orderBy: [staff ? sql`${r.status} = 'REQUESTED' desc` : sql`${r.status} = 'OPTIONS_SENT' desc`, desc(r.updatedAt)],
    limit: 100,
  });
  const openId = sp.id ?? list[0]?.id;
  const open = openId ? await optionRequestForUser(user, openId) : null;
  const detail = open
    ? await db.query.optionRequests.findFirst({
        where: eq(r.id, open.id),
        with: {
          org: { columns: { name: true } },
          requestedBy: { columns: { name: true } },
          assignedTo: { columns: { name: true, phone: true } },
          student: { columns: { id: true, firstName: true, lastName: true } },
          files: true,
          messages: { with: { author: { columns: { name: true, role: true } } }, orderBy: asc(schema.optionRequestMessages.createdAt) },
          programs: { with: { program: { with: { university: { with: { country: true } } } } }, orderBy: asc(schema.optionRequestPrograms.createdAt) },
        },
      })
    : null;
  const countries = new Map((await db.select().from(schema.countries)).map((c) => [c.code, c.name]));
  const linkable = detail && !detail.studentId
    ? await db.select({ id: schema.students.id, firstName: schema.students.firstName, lastName: schema.students.lastName }).from(schema.students).where(and(eq(schema.students.orgId, detail.orgId), eq(schema.students.archived, false))).orderBy(asc(schema.students.firstName)).limit(300)
    : [];
  // The team's finder: live programs matching the words, in the request's destinations first.
  const finder = staff && detail && sp.pq
    ? await db
        .select({ id: schema.programs.id, name: schema.programs.name, level: schema.programs.level, university: schema.universities.name, country: schema.countries.code, perYear: schema.programs.tuitionPerYear, total: schema.programs.tuitionTotal, currency: schema.countries.currency })
        .from(schema.programs)
        .innerJoin(schema.universities, eq(schema.programs.universityId, schema.universities.id))
        .innerJoin(schema.countries, eq(schema.universities.countryId, schema.countries.id))
        .where(and(eq(schema.programs.status, "LIVE"), or(ilike(schema.programs.name, `%${sp.pq}%`), ilike(schema.universities.name, `%${sp.pq}%`), ilike(schema.programs.studyArea, `%${sp.pq}%`))))
        .orderBy(sql`${schema.countries.code} = any(string_to_array(${detail.destinations.join(",")}, ',')) desc`, asc(schema.programs.name))
        .limit(20)
    : [];
  const href = (extra: Partial<SP>) => `/program-options?${new URLSearchParams(Object.entries({ tab: sp.tab, q: sp.q, status: sp.status, id: openId, ...extra }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader
        title="Program options"
        subtitle={staff ? "Requests from every branch. Build the list, then send it." : "Ask the Overseas team what fits a student; their list comes back here."}
        actions={!staff || user.role !== "DOCUMENTATION" ? <LinkButton href="/program-options/new">Request program options</LinkButton> : undefined}
      />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Link href={href({ tab: undefined, id: undefined })} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", !archived ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft")}>Requested</Link>
            <Link href={href({ tab: "archived", id: undefined })} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", archived ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft")}>Archived</Link>
          </div>
          <form className="flex gap-2">
            {archived && <input type="hidden" name="tab" value="archived" />}
            <Input name="q" defaultValue={sp.q} placeholder="Student or request no." aria-label="Search requests" />
            <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-36">
              <option value="">Any status</option>
              {Object.entries(OPTIONS_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Go</Button>
          </form>
          {list.length === 0 ? (
            <Card><EmptyState title={archived ? "Nothing archived" : "No requests yet"}>{archived ? "" : "Send the team a student's profile and they come back with programs."}</EmptyState></Card>
          ) : (
            <ul className="space-y-2">
              {list.map((x) => (
                <li key={x.id}>
                  <Link href={href({ id: x.id })} aria-current={x.id === openId ? "true" : undefined} className={cn("block rounded-lg border bg-surface px-3 py-2.5", x.id === openId ? "border-brand-600 ring-2 ring-brand-100" : "border-line hover:border-brand-300")}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{x.studentName}</p>
                      <Chip tone={OPTIONS_STATUS_TONE[x.status]}>{OPTIONS_STATUS_LABEL[x.status]}</Chip>
                    </div>
                    <p className="text-xs text-muted">{x.requestNo} · {x.destinations.map((c) => countries.get(c) ?? c).join(", ")}</p>
                    <p className="text-xs text-muted">{fmtDateTime(x.createdAt)} · {x.requestedBy?.name ?? ""}{staff ? ` · ${x.org.name}` : ""}{x.programs.length ? ` · ${x.programs.length} program${x.programs.length === 1 ? "" : "s"}` : ""}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {detail ? (
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{detail.studentName}</p>
                  <p className="text-[13px] text-muted">{detail.requestNo} · asked {fmtDateTime(detail.createdAt)} by {detail.requestedBy?.name ?? "someone who has left"}{staff ? ` · ${detail.org.name}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip tone={OPTIONS_STATUS_TONE[detail.status]}>{OPTIONS_STATUS_LABEL[detail.status]}</Chip>
                  <form action={setArchivedAction}>
                    <input type="hidden" name="requestId" value={detail.id} />
                    <input type="hidden" name="archived" value={detail.archived ? "false" : "true"} />
                    <Button type="submit" variant="quiet" size="sm">{detail.archived ? "Restore" : "Archive"}</Button>
                  </form>
                </div>
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                <div><dt className="text-muted">Educated in</dt><dd>{detail.educationCountry ?? "Not given"}</dd></div>
                <div><dt className="text-muted">Highest level</dt><dd>{detail.highestLevel}</dd></div>
                <div><dt className="text-muted">Destinations</dt><dd>{detail.destinations.map((c) => countries.get(c) ?? c).join(", ")}</dd></div>
                <div><dt className="text-muted">Wants to study</dt><dd>{detail.studyLevels.map((l) => LEVEL_LABEL[l] ?? l).join(", ")}</dd></div>
                <div><dt className="text-muted">Areas</dt><dd>{detail.studyAreas.join(", ")}</dd></div>
                <div><dt className="text-muted">With the team</dt><dd>{detail.assignedTo ? `${detail.assignedTo.name}${detail.assignedTo.phone ? ` · ${detail.assignedTo.phone}` : ""}` : "Not picked up yet"}</dd></div>
              </dl>
              {detail.additionalInfo && <p className="mt-3 whitespace-pre-wrap rounded-md bg-ground/60 px-3 py-2 text-[13px]">{detail.additionalInfo}</p>}
              {detail.files.length > 0 && (
                <p className="mt-3 flex flex-wrap gap-2 text-[13px]">
                  {detail.files.map((f) => <a key={f.id} href={`/api/option-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="rounded border border-line px-2 py-0.5 text-brand-600 hover:underline">{f.fileName}</a>)}
                </p>
              )}
              <div className="mt-3 border-t border-line pt-3 text-[13px]">
                {detail.student ? (
                  <p>Student file: <Link href={`/students/${detail.student.id}/profile`} className="font-medium text-brand-600 hover:underline">{fullName(detail.student)}</Link></p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted">Not registered yet.</span>
                    <LinkButton href="/students/new" variant="secondary" size="sm">Register the student</LinkButton>
                    {linkable.length > 0 && (
                      <form action={linkStudentAction} className="flex items-center gap-2">
                        <input type="hidden" name="requestId" value={detail.id} />
                        <Select name="studentId" defaultValue="" aria-label="Link to a student" className="w-52">
                          <option value="">Link to a registered student</option>
                          {linkable.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
                        </Select>
                        <Button type="submit" variant="quiet" size="sm">Link</Button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="font-semibold">Recommended programs ({detail.programs.length})</h2>
                {!staff && detail.student && detail.programs.length > 0 && <ShortlistAllForm requestId={detail.id} count={detail.programs.length} student={detail.student.firstName} />}
                {staff && detail.programs.length > 0 && detail.status === "REQUESTED" && (
                  <form action={sendOptionsAction}>
                    <input type="hidden" name="requestId" value={detail.id} />
                    <Button type="submit" size="sm">Send {detail.programs.length} option{detail.programs.length === 1 ? "" : "s"} to the partner</Button>
                  </form>
                )}
              </div>
              {detail.programs.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-muted">{staff ? "Add programs below, then send the list." : "The Overseas team is working on it. You are notified when the list is ready."}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {detail.programs.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/programs/${x.program.id}${detail.studentId ? `?student=${detail.studentId}` : ""}`} className="font-medium hover:text-brand-700 hover:underline">{x.program.name}</Link>
                        <p className="text-xs text-muted">{x.program.university.name}, {x.program.university.country.name} · {LEVEL_LABEL[x.program.level] ?? x.program.level} · {tuitionText(x.program.tuitionPerYear, x.program.tuitionTotal, x.program.university.country.currency)}</p>
                        {x.note && <p className="text-xs text-ink-soft">{x.note}</p>}
                      </div>
                      <div className="flex gap-2">
                        {!staff && detail.studentId && <LinkButton href={`/students/${detail.studentId}/applications?tab=apply&program=${x.program.id}`} size="sm" variant="secondary">Apply</LinkButton>}
                        {staff && (
                          <form action={removeOptionAction}>
                            <input type="hidden" name="id" value={x.id} />
                            <Button type="submit" variant="quiet" size="sm">Remove</Button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {staff && (
                <div className="border-t border-line p-4">
                  <form className="flex gap-2">
                    <input type="hidden" name="id" value={detail.id} />
                    {archived && <input type="hidden" name="tab" value="archived" />}
                    <Input name="pq" defaultValue={sp.pq} placeholder="Find programs to add: name, university or field" aria-label="Find programs" />
                    <Button type="submit" variant="secondary" size="sm">Find</Button>
                  </form>
                  {finder.length > 0 && (
                    <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                      {finder.filter((p) => !detail.programs.some((x) => x.program.id === p.id)).map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                          <span className="min-w-0"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.university} · {p.country} · {LEVEL_LABEL[p.level] ?? p.level} · {tuitionText(p.perYear, p.total, p.currency)}</span></span>
                          <form action={addOptionAction}>
                            <input type="hidden" name="requestId" value={detail.id} />
                            <input type="hidden" name="programId" value={p.id} />
                            <Button type="submit" variant="quiet" size="sm">Add</Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h2 className="mb-2 font-semibold">Messages</h2>
              <ul className="mb-3 space-y-2">
                {detail.messages.map((m) => {
                  const team = m.author ? !["PARTNER", "COUNSELLOR"].includes(m.author.role) : false;
                  return (
                    <li key={m.id} className={cn("flex", team ? "justify-start" : "justify-end")}>
                      <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[13px]", team ? "bg-brand-50" : "bg-slate-100")}>
                        <p className="text-xs font-semibold">{m.author?.name ?? "Former user"}{team && <span className="font-normal text-brand-700"> · Overseas team</span>}</p>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="text-[11px] text-muted">{fmtDateTime(m.createdAt)}</p>
                      </div>
                    </li>
                  );
                })}
                {detail.messages.length === 0 && <li className="text-[13px] text-muted">No messages yet.</li>}
              </ul>
              <OptionMessageForm requestId={detail.id} />
            </Card>
          </div>
        ) : (
          <Card><EmptyState title="Nothing selected">Pick a request on the left, or send a new one.</EmptyState></Card>
        )}
      </div>
    </>
  );
}
