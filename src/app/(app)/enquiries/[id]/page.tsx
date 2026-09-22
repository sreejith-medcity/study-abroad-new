import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { orgUsers } from "@/server/queries";
import { SOURCE_LABEL, STAGE_LABEL, STAGE_TONE, getEnquiryForUser } from "@/server/enquiries";
import { Alert, Button, Card, CardHeader, Chip, DataList, LinkButton, PageHeader, Select } from "@/components/ui";
import { IconChat, IconCheck, IconPlus } from "@/components/icons";
import { EnquiryForm, FollowUpForm, LostForm } from "../forms";
import { claimEnquiryAction, setEnquiryStageAction } from "../actions";

export const metadata = { title: "Enquiry" };

const OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const { id } = await params;
  const enquiry = await getEnquiryForUser(user, id);
  const [people, countries] = await Promise.all([
    orgUsers(enquiry.orgId),
    db.select({ name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name)),
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
          <Link href="/enquiries" className="text-[13px] font-medium text-brand-600 hover:underline">
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
          ) : !isStaff(user) ? (
            <LinkButton href={convertHref}>
              <IconPlus className="size-4" /> Register as student
            </LinkButton>
          ) : undefined
        }
      />

      {overdue && (
        <Alert tone="warn" title="Follow up is overdue">
          This was due {fmtDate(enquiry.nextFollowUpAt)}. Log what happened below and set the next date.
        </Alert>
      )}
      {enquiry.stage === "LOST" && enquiry.lostReason && (
        <Alert tone="bad" title="Closed as lost">{enquiry.lostReason}</Alert>
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
              <p className="px-4 py-8 text-center text-[13px] text-muted">Nothing logged yet.</p>
            ) : (
              <ol className="relative px-4 py-3">
                {notes.map((n) => (
                  <li key={n.id} className="relative flex gap-3 border-l border-line pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-brand-600 ring-4 ring-surface" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-[13px] font-medium">{n.author?.name ?? "System"}</span>
                        {n.stageAfter && <Chip tone={STAGE_TONE[n.stageAfter]}>{STAGE_LABEL[n.stageAfter]}</Chip>}
                        <span className="ml-auto text-xs text-muted">{fmtDateTime(n.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">{n.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

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
                { label: "Pathway", value: enquiry.interestPathway === "AUSBILDUNG" ? "Ausbildung" : enquiry.interestPathway === "NURSING" ? "Nurse registration" : enquiry.interestPathway === "DEGREE" ? "Degree" : "Open" },
                { label: "Destination", value: enquiry.interestCountry ?? "Not decided" },
                { label: "Intake", value: enquiry.intakeMonth && enquiry.intakeYear ? intakeLabel(enquiry.intakeMonth, enquiry.intakeYear) : "Not decided" },
                { label: "Budget", value: enquiry.budgetLakhs ? `${enquiry.budgetLakhs} lakhs` : "Not discussed" },
                { label: "Owner", value: enquiry.assignedTo?.name ?? "Unassigned" },
                { label: "Last contacted", value: enquiry.lastContactedAt ? fmtDate(enquiry.lastContactedAt) : "Never" },
                { label: "Next follow up", value: enquiry.nextFollowUpAt ? fmtDate(enquiry.nextFollowUpAt) : "Not set", tone: overdue ? "bad" : undefined },
              ]}
            />
            {open && (
              <div className="space-y-2 border-t border-line p-4">
                <form action={setEnquiryStageAction} className="flex gap-2">
                  <input type="hidden" name="enquiryId" value={enquiry.id} />
                  <Select name="stage" defaultValue={enquiry.stage} aria-label="Stage" className="py-1.5 text-[13px]">
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
                <LostForm enquiryId={enquiry.id} />
              </div>
            </Card>
          )}

          {enquiry.stage === "CONVERTED" && enquiry.student && (
            <Card className="p-4">
              <h2 className="font-display text-[15px] font-semibold">Became a student</h2>
              <p className="mt-1 text-[13px] text-muted">
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
