import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, PARTNER_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { orgUsers } from "@/server/queries";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, getEnquiryForUser } from "@/server/enquiries";
import { Alert, Button, Card, CardHeader, Chip, DataList, LinkButton, PageHeader, Select } from "@/components/ui";
import { IconChat, IconCheck, IconPlus } from "@/components/icons";
import { EnquiryForm, FollowUpForm, LostForm, MergeForm } from "../forms";
import { possibleDuplicates } from "@/server/enquiry-routing";
import { mergedInto } from "@/server/enquiry-merge";
import { lostReasonList } from "@/server/lost-reasons";
import { lostReasonText } from "@/lib/lost-reasons";
import { mayMerge } from "@/lib/enquiry-routing";
import { claimEnquiryAction, setEnquiryStageAction } from "../actions";
import { SubTabs } from "@/components/tabs";
import { OwnershipTimeline } from "@/components/ownership-timeline";
import { ledgerFor } from "@/server/ledger";

export const metadata = { title: "Enquiry" };

const OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];

export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ repeat?: string; merged?: string }> }) {
  const user = await requireUser([...PARTNER_ROLES, ...ADMIN_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  const enquiry = await getEnquiryForUser(user, id);
  const merged = enquiry.stage === "MERGED";
  const [people, countries, reasons, duplicates, folded, ownership] = await Promise.all([
    orgUsers(enquiry.orgId),
    db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name)),
    lostReasonList({ activeOnly: true }),
    merged ? Promise.resolve({ visible: [], elsewhere: 0 }) : possibleDuplicates(user, enquiry),
    mergedInto(enquiry.id),
    ledgerFor("enquiry", enquiry.id),
  ]);

  const notes = [...enquiry.notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const open = OPEN_STAGES.includes(enquiry.stage);
  const overdue = enquiry.nextFollowUpAt && enquiry.nextFollowUpAt.getTime() < Date.now() && open;
  const [firstName, ...rest] = enquiry.name.trim().split(/\s+/);
  const convertHref = `/students/new?${new URLSearchParams({
    enquiryId: enquiry.id,
    firstName,
    lastName: rest.join(" "),
    ...(enquiry.email ? { email: enquiry.email } : {}),
    phone: enquiry.phone,
    ...(enquiry.interestCountry ? { preferredCountry: enquiry.interestCountry } : {}),
    ...(enquiry.interestPathway ? { preferredPathway: enquiry.interestPathway } : {}),
  }).toString()}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/enquiries" className="text-sm font-medium text-brand-600 hover:underline">
            ← All enquiries
          </Link>
        }
        title={enquiry.name}
        subtitle={`${SOURCE_LABEL[enquiry.source]} · logged ${fmtDate(enquiry.createdAt)}${isStaff(user) ? ` · ${enquiry.org.name}` : ""}`}
        actions={
          enquiry.stage === "CONVERTED" && enquiry.studentId ? (
            <LinkButton href={`/students/${enquiry.studentId}/profile`} variant="secondary">
              <IconCheck className="size-4" /> Open student file
            </LinkButton>
          ) : !isStaff(user) && !merged ? (
            <LinkButton href={convertHref}>
              <IconPlus className="size-4" /> Register as student
            </LinkButton>
          ) : undefined
        }
      />

      <div className="mb-4">
        <SubTabs
          label="Enquiry"
          tabs={[
            { href: `/enquiries/${enquiry.id}`, label: "Enquiry" },
            { href: `/enquiries/${enquiry.id}/history`, label: "History" },
          ]}
        />
      </div>

      {sp.repeat === "note" && (
        <Alert tone="info" title="Already on the list">
          This number already had an open enquiry, so what you entered was added to it as a note instead of making a second one.
        </Alert>
      )}
      {sp.repeat === "reopen" && (
        <Alert tone="info" title="A lost enquiry came back">
          This number had an enquiry closed as lost. It is reopened, with a note saying it came back.
        </Alert>
      )}
      {sp.merged && <Alert tone="ok" title="Merged">The duplicate&apos;s history is on this enquiry now, and the duplicate is closed as merged.</Alert>}
      {merged && (
        <Alert tone="info" title="Merged into another enquiry">
          {enquiry.mergedInto ? (
            <>
              This was folded into{" "}
              <Link href={`/enquiries/${enquiry.mergedInto.id}`} className="font-medium underline">
                {enquiry.mergedInto.name}&apos;s enquiry
              </Link>
              {enquiry.mergedAt ? ` on ${fmtDate(enquiry.mergedAt)}` : ""}. Its history is there.
            </>
          ) : (
            "It was folded into another enquiry."
          )}
        </Alert>
      )}
      {overdue && (
        <Alert tone="warn" title="Follow up is overdue">
          This was due {fmtDate(enquiry.nextFollowUpAt)}. Log what happened below and set the next date.
        </Alert>
      )}
      {enquiry.stage === "LOST" && (
        <Alert tone="bad" title="Closed as lost">{lostReasonText(enquiry.lostReasonPicked?.label, enquiry.lostReason)}</Alert>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          {enquiry.answers.length > 0 && (
            <Card>
              <CardHeader title="Answers on your form" subtitle="To the questions you added in Settings, Students" />
              <DataList rows={enquiry.answers.map((a) => ({ label: a.question, value: a.answer }))} />
            </Card>
          )}
          {open && (
            <Card>
              <CardHeader title="Log a follow up" subtitle="Every call, message and visit, in one line each" />
              <div className="p-4 pt-0">
                <FollowUpForm enquiryId={enquiry.id} stage={enquiry.stage} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="History" subtitle={`${notes.length} entr${notes.length === 1 ? "y" : "ies"}`} />
            {notes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing logged yet.</p>
            ) : (
              <ol className="relative px-4 py-3">
                {notes.map((n) => (
                  <li key={n.id} className="relative flex gap-3 border-l border-line pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-brand-600 ring-4 ring-surface" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium">{n.author?.name ?? "System"}</span>
                        {n.stageAfter && <Chip tone={STAGE_TONE[n.stageAfter]}>{STAGE_LABEL[n.stageAfter]}</Chip>}
                        <span className="ml-auto text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {!merged && (
          <Card>
            <CardHeader title="Details" subtitle="Correct anything that changed" />
            <div className="p-4 pt-0">
              <EnquiryForm
                mode="edit"
                people={people}
                countries={countries.map((c) => c.name)}
                values={{
                  id: enquiry.id,
                  name: enquiry.name,
                  phone: enquiry.phone,
                  email: enquiry.email,
                  city: enquiry.city,
                  source: enquiry.source,
                  interestCountry: enquiry.interestCountry,
                  interestPathway: enquiry.interestPathway,
                  intakeMonth: enquiry.intakeMonth,
                  intakeYear: enquiry.intakeYear,
                  budgetLakhs: enquiry.budgetLakhs,
                  assignedToId: enquiry.assignedToId,
                  nextFollowUpAt: enquiry.nextFollowUpAt,
                  notes: enquiry.notes.length ? enquiry.notes[0].body : null,
                }}
              />
            </div>
          </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Where this stands"
              action={<Chip tone={STAGE_TONE[enquiry.stage]}>{STAGE_LABEL[enquiry.stage]}</Chip>}
            />
            <DataList
              rows={[
                { label: "Mobile", value: enquiry.phone },
                { label: "Email", value: enquiry.email ?? "None" },
                { label: "Town", value: enquiry.city ?? "Not given" },
                { label: "Pathway", value: enquiry.interestPathway === "AUSBILDUNG" ? "Ausbildung" : enquiry.interestPathway === "NURSING" ? "Nurse registration" : enquiry.interestPathway === "FSJ" ? "FSJ (Germany)" : enquiry.interestPathway === "BFD" ? "BFD (Germany)" : enquiry.interestPathway === "DEGREE" ? "Degree" : "Open" },
                { label: "Destination", value: enquiry.interestCountry ?? "Not decided" },
                { label: "Intake", value: enquiry.intakeMonth && enquiry.intakeYear ? intakeLabel(enquiry.intakeMonth, enquiry.intakeYear) : "Not decided" },
                { label: "Budget", value: enquiry.budgetLakhs ? `${enquiry.budgetLakhs} lakhs` : "Not discussed" },
                { label: "Owner", value: enquiry.assignedTo?.name ?? "Unassigned" },
                { label: "Last contacted", value: enquiry.lastContactedAt ? fmtDate(enquiry.lastContactedAt) : "Never" },
                { label: "Next follow up", value: enquiry.nextFollowUpAt ? fmtDate(enquiry.nextFollowUpAt) : "Not set", tone: overdue ? "bad" : undefined },
                ...(enquiry.repeatCount > 0 ? [{ label: "Came again", value: `${enquiry.repeatCount} time${enquiry.repeatCount === 1 ? "" : "s"}` }] : []),
              ]}
            />
            {open && (
              <div className="space-y-2 border-t border-line p-4">
                <form action={setEnquiryStageAction} className="flex gap-2">
                  <input type="hidden" name="enquiryId" value={enquiry.id} />
                  <Select name="stage" defaultValue={enquiry.stage} aria-label="Stage" className="py-1.5 text-sm">
                    <option value="NEW">New</option>
                    <option value="CONTACTED">Contacted</option>
                    <option value="QUALIFIED">Qualified</option>
                    <option value="COUNSELLING">In counselling</option>
                  </Select>
                  <Button type="submit" variant="secondary" size="sm">Set stage</Button>
                </form>
                {enquiry.assignedToId !== user.id && !isStaff(user) && (
                  <form action={claimEnquiryAction}>
                    <input type="hidden" name="enquiryId" value={enquiry.id} />
                    <Button type="submit" variant="quiet" size="sm">
                      <IconChat className="size-4" /> Assign this to me
                    </Button>
                  </form>
                )}
              </div>
            )}
          </Card>

          {open && (
            <Card>
              <CardHeader title="Not going ahead?" subtitle="Closing it keeps the follow-up list honest" />
              <div className="p-4 pt-0">
                <LostForm enquiryId={enquiry.id} reasons={reasons} />
              </div>
            </Card>
          )}

          {!merged && (duplicates.visible.length > 0 || duplicates.elsewhere > 0) && (
            <Card>
              <CardHeader
                title="Possible duplicates"
                subtitle="Other enquiries with the same number or email"
                action={<Chip tone="warn">{duplicates.visible.length + duplicates.elsewhere}</Chip>}
              />
              <ul className="divide-y divide-line border-t border-line" aria-label="Possible duplicates">
                {duplicates.visible.map((d) => (
                  <li key={d.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Link href={`/enquiries/${d.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                        {d.name}
                      </Link>
                      <Chip tone={STAGE_TONE[d.stage]}>{STAGE_LABEL[d.stage]}</Chip>
                    </div>
                    <p className="text-xs text-muted">
                      Same {d.matchedOn} · {d.orgName} · {d.ownerName ?? "Unassigned"} · logged {fmtDate(d.createdAt)}
                    </p>
                    {mayMerge(user, enquiry.orgId, d.orgId) && d.stage !== "CONVERTED" && (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-brand-600">Merge {d.name} into this one</summary>
                        <div className="mt-2">
                          <MergeForm keepId={enquiry.id} removeId={d.id} removeName={d.name} keepName={enquiry.name} />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {duplicates.elsewhere > 0 && (
                <p className="border-t border-line px-4 py-3 text-xs text-muted">
                  {duplicates.elsewhere} more with another branch. The head office can see {duplicates.elsewhere === 1 ? "it" : "them"} and merge.
                </p>
              )}
            </Card>
          )}

          {folded.length > 0 && (
            <Card>
              <CardHeader title="Merged into this one" subtitle={`${folded.length} duplicate${folded.length === 1 ? "" : "s"}`} />
              <ul className="divide-y divide-line border-t border-line">
                {folded.map((f) => (
                  <li key={f.id} className="p-4 text-sm">
                    <Link href={`/enquiries/${f.id}`} className="font-medium text-brand-600 hover:underline">{f.name}</Link>
                    <span className="text-xs text-muted"> · {f.phone}{f.mergedAt ? ` · ${fmtDate(f.mergedAt)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <OwnershipTimeline entries={ownership} owner={enquiry.assignedTo?.name ?? "nobody"} admin={isStaff(user) && isAdmin(user)} />

          {enquiry.stage === "CONVERTED" && enquiry.student && (
            <Card className="p-4">
              <h2 className="font-display text-base font-semibold">Became a student</h2>
              <p className="mt-1 text-sm text-muted">
                {enquiry.student.firstName} {enquiry.student.lastName} was registered from this enquiry.
              </p>
              <LinkButton href={`/students/${enquiry.student.id}/profile`} variant="secondary" size="sm" className="mt-3">
                Open the student file
              </LinkButton>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
