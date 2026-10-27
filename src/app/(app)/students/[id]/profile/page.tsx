import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { can } from "@/server/capabilities";
import { profileCompleteness } from "@/lib/checks";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { APP_ROLES, PARTNER_ROLES, ROLE_LABEL, canAssignStudents, canSeeFullPassport, isAdmin, isStaff, maskPassport } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { Alert, Button, Card, Chip } from "@/components/ui";
import { Section } from "@/components/section";
import { deleteProfileRowAction, revealPassportAction, toggleLockAction, togglePortalAccessAction } from "../../actions";
import { AcademicForm, BackgroundForm, ContactForm, PersonalForm, PortalInviteForm, RequestEditForm, TestForm, WorkForm } from "./forms";
import { BACKGROUND_QUESTIONS, backgroundComplete } from "@/lib/background";
import { aiFeatureOn } from "@/server/ai";
import { guardiansFor, GUARDIAN_LIMIT } from "@/server/family";
import { AddGuardianForm, GuardianRowActions, ResetGuardianForm } from "@/components/family-forms";
import { AutofillPanel } from "./autofill";
import { livingTeams, peopleOnFile, peopleToAdd, teamToLead } from "@/server/teams";
import { removePersonFromFileAction, setStudentTeamAction } from "./team-actions";
import { AddPersonForm, GiveToTeamMemberForm } from "./team-panel";
import { moveStudentAction } from "./move-actions";
import { StudentMoveForm } from "@/components/student-move-form";
import { MOVE_KEEPS } from "@/lib/student-move";
import { moveBranchOptions } from "@/server/student-move";

export const metadata = { title: "Student profile" };

const LEVEL = { SCHOOL: "Std. 12th / school", UG_DIPLOMA: "Diploma", UG: "Bachelor's", PG_DIPLOMA: "PG diploma", PG: "Master's", PHD: "PhD", TOP_UP: "Top-up degree", VOCATIONAL: "Vocational", REGISTRATION: "Registration", CERTIFICATE: "Certificate" } as const;

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reveal?: string }> }) {
  const { id } = await params;
  const { reveal } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [academics, tests, work, openRequests, portalAccount, contacts, guardians] = await Promise.all([
    db.select().from(schema.academicRecords).where(eq(schema.academicRecords.studentId, id)).orderBy(asc(schema.academicRecords.yearCompleted)),
    db.select().from(schema.testScores).where(eq(schema.testScores.studentId, id)),
    db.select().from(schema.workExperience).where(eq(schema.workExperience.studentId, id)).orderBy(asc(schema.workExperience.startDate)),
    db.select().from(schema.editRequests).where(and(eq(schema.editRequests.studentId, id), eq(schema.editRequests.status, "OPEN"))),
    db.query.users.findFirst({ where: and(eq(schema.users.studentId, id), eq(schema.users.role, "STUDENT")) }),
    db.select().from(schema.studentContacts).where(eq(schema.studentContacts.studentId, id)).orderBy(asc(schema.studentContacts.createdAt)),
    guardiansFor(id),
  ]);
  const liveGuardians = guardians.filter((g) => !g.revokedAt);

  const autofill = await aiFeatureOn("autofill");
  const readable = autofill
    ? await db.query.documents.findMany({
        // The current version of each: reading a replaced scan would fill the
        // profile from the file the team stopped trusting.
        where: and(
          eq(schema.documents.studentId, id),
          inArray(schema.documents.typeCode, ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "DEGREE_CERTIFICATE", "ENGLISH_TEST"]),
          isNull(schema.documents.supersededAt),
          isNull(schema.documents.removedAt),
        ),
        with: { type: { columns: { label: true } } },
        orderBy: desc(schema.documents.createdAt),
        limit: 8,
      })
    : [];
  const done = profileCompleteness({ ...student, academics, tests, documentTypeCodes: [] });
  const readOnly = user.role === "MANAGEMENT" || (student.profileLocked && !isAdmin(user));
  // A locked profile stops the details being edited. Who may read the file is a
  // separate question, so family access follows the role and not the lock.
  const canManageFamily = user.role !== "MANAGEMENT";
  const showFull = (await can(user, "SEE_FULL_PASSPORT")) || reveal === "1";
  const passportDisplay = showFull ? student.passportNumber ?? "" : maskPassport(student.passportNumber);

  /*
    Who carries this file, besides the counsellor it is assigned to.

    This was the desk's panel alone, on the reasoning that a branch names its
    own counsellor and nothing else. That was wrong about how a branch works:
    two counsellors sharing a student, or one covering while the other is
    away, is the ordinary case, and the only way to record it was to ask the
    head office. A branch sees the panel now and may put its own people on its
    own students. The team row above stays the desk's, because which part of
    the business carries a file is not a branch's call.
  */
  const staffHere = isStaff(user);
  // A team member from another branch works the file but does not run it:
  // who else is on it is the student's own branch's call, and the people a
  // branch user could add are their own branch's, who could not open it.
  const otherBranch = !staffHere && student.orgId !== user.orgId;
  const mayAssign = canAssignStudents(user) && !otherBranch;
  // What they asked for before they were a student. The enquiry already
  // points at this file; it was simply never shown here, so the desk read a
  // registration with none of the conversation that led to it.
  const enquiry = await db.query.enquiries.findFirst({
    where: eq(schema.enquiries.studentId, id),
    with: { notes: { orderBy: desc(schema.enquiryNotes.createdAt), limit: 20 } },
  });

  const [teams, onFile, staff, teamMembers] = await Promise.all([
    staffHere ? livingTeams() : Promise.resolve([]),
    peopleOnFile(id),
    mayAssign ? peopleToAdd(user) : Promise.resolve([]),
    // The team's people, when this person leads the team carrying the file.
    teamToLead(user.id, student.teamId),
  ]);
  const leadsTeam = teamMembers.length > 0 && !!student.team;
  // Which branch the student belongs to is the head office admins' call, and
  // only for a file still in use: an archived one is brought back first.
  const mayMoveBranch = isAdmin(user) && !student.archived;
  const moveTargets = mayMoveBranch ? await moveBranchOptions(student.orgId) : [];

  // One source for the row at the top and for whether each part opens folded.
  // A part that is done folds away; a part still wanting something stays open,
  // so what is on screen is the work left rather than the whole file.
  const state = {
    personal: done.personal ? "Complete" : "Incomplete",
    academics: done.academics ? "Complete" : "Incomplete",
    work: work.length ? "Complete" : "Optional",
    tests: done.tests ? "Complete" : "Incomplete",
    background: backgroundComplete(student.background) ? "Complete" : "Incomplete",
    contacts: contacts.length ? "Complete" : "Optional",
  } as const;
  const sections = [
    { href: "#personal", label: "Personal information", state: state.personal },
    { href: "#academics", label: "Academic qualifications", state: state.academics },
    { href: "#work", label: "Work experience", state: state.work },
    { href: "#tests", label: "Tests", state: state.tests },
    { href: "#background", label: "Background", state: state.background },
    { href: "#contacts", label: "Contacts", state: state.contacts },
  ];
  // Optional and empty is nothing to look at either, so only Incomplete opens.
  const wants = (v: (typeof state)[keyof typeof state]) => v === "Incomplete";

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-3 xl:grid-cols-6">
        {sections.map((s) => (
          <a key={s.href} href={s.href} className="bg-surface px-4 py-3 text-center hover:bg-ground">
            <p className="font-medium">{s.label}</p>
            <p className={s.state === "Complete" ? "text-xs text-good-700" : s.state === "Optional" ? "text-xs text-muted" : "text-xs text-stop-500"}>{s.state}</p>
          </a>
        ))}
      </Card>

      {student.profileLocked && (
        <Alert tone="info">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              This profile is locked because applications have been submitted.{" "}
              {isAdmin(user) ? "You can unlock it to allow changes." : "Send an edit request and the Medcity Overseas team will make the change or unlock it."}
            </span>
            {isAdmin(user) && (
              <form action={toggleLockAction}>
                <input type="hidden" name="studentId" value={id} />
                <Button variant="secondary" className="py-1">Unlock profile</Button>
              </form>
            )}
          </div>
        </Alert>
      )}
      {!student.profileLocked && isAdmin(user) && (
        <form action={toggleLockAction} className="text-right">
          <input type="hidden" name="studentId" value={id} />
          <Button variant="quiet" className="py-1">Lock profile</Button>
        </form>
      )}
      {openRequests.length > 0 && (
        <Card className="border-warn-500/25 p-4">
          <h2 className="font-semibold">Open edit requests</h2>
          <ul className="mt-2 space-y-1">
            {openRequests.map((r) => <li key={r.id}><Chip tone="warn">{r.section}</Chip> {r.message} <span className="text-xs text-muted">{fmtDateTime(r.createdAt)}</span></li>)}
          </ul>
        </Card>
      )}
      {student.profileLocked && (PARTNER_ROLES as readonly string[]).includes(user.role) && (
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Request an edit</h2>
          <RequestEditForm studentId={id} />
        </Card>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 font-semibold">
              Student portal
              {portalAccount ? (
                portalAccount.active ? <Chip tone="ok">Has access</Chip> : <Chip tone="bad">Switched off</Chip>
              ) : (
                <Chip>Not invited</Chip>
              )}
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              {portalAccount
                ? `${portalAccount.email} can sign in to see this application, upload what is missing and message the branch. ${
                    portalAccount.lastSignInAt ? `Last signed in ${fmtDate(portalAccount.lastSignInAt)}.` : "Has not signed in yet."
                  }`
                : "Gives the student their own login, in English or Malayalam, showing only their own file."}
            </p>
          </div>
          {portalAccount && (
            <form action={togglePortalAccessAction}>
              <input type="hidden" name="studentId" value={id} />
              <Button variant="quiet" className="py-1 text-xs">{portalAccount.active ? "Switch off access" : "Switch access back on"}</Button>
            </form>
          )}
        </div>
        <div className="mt-3">
          <PortalInviteForm studentId={id} invited={!!portalAccount} />
        </div>
      </Card>

      <Card className="p-4" id="family">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 font-semibold">
              Family access
              {liveGuardians.length > 0 ? <Chip tone="ok">{liveGuardians.length} can read this file</Chip> : <Chip>Nobody added</Chip>}
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              A parent or sponsor signs in to a view of their own: which step {student.firstName} is on, what is still wanted, and the dates that matter. They cannot
              change anything, send messages or open the files. {student.firstName} is told on WhatsApp whenever somebody is added, because it is their file.
            </p>
          </div>
        </div>

        {guardians.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {guardians.map((g) => (
              <li key={g.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-2.5">
                <div className="min-w-48">
                  <p className={g.revokedAt || !g.active ? "text-muted line-through" : "font-medium"}>{g.name}</p>
                  <p className="text-xs text-muted">{g.relation} · {g.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {g.revokedAt ? (
                    <Chip tone="bad">Removed {fmtDate(g.revokedAt)}</Chip>
                  ) : (
                    <>
                      {g.seesMoney && <Chip tone="warn">Sees the fees</Chip>}
                      <Chip>{g.lastSignInAt ? `Last read ${fmtDate(g.lastSignInAt)}` : "Has not signed in"}</Chip>
                      {!g.studentToldAt && <Chip tone="warn">{student.firstName} not told</Chip>}
                    </>
                  )}
                </div>
                {!g.revokedAt && canManageFamily && (
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <GuardianRowActions guardianId={g.id} seesMoney={g.seesMoney} />
                    <ResetGuardianForm guardianId={g.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManageFamily && liveGuardians.length < GUARDIAN_LIMIT && (
          <div className="mt-4 border-t border-line pt-4">
            <AddGuardianForm studentId={id} />
          </div>
        )}
        {liveGuardians.length >= GUARDIAN_LIMIT && (
          <p className="mt-3 text-sm text-muted">{GUARDIAN_LIMIT} family sign-ins is the limit. Remove one to add another.</p>
        )}
      </Card>

      {autofill && !readOnly && readable.length > 0 && (
        <Card className="p-4" id="autofill">
          <h2 className="font-semibold">Fill from a document</h2>
          <p className="mb-3 text-sm text-muted">The file is sent to an AI service to be read. You check what it found before anything is saved.</p>
          <AutofillPanel studentId={id} docs={readable.map((d) => ({ id: d.id, label: d.type?.label ?? d.fileName }))} />
        </Card>
      )}

      {enquiry && (
        <Section
          id="enquiry"
          title="Before they registered"
          meta={[
            `Enquiry from ${fmtDate(enquiry.createdAt)}`,
            enquiry.source.replace(/_/g, " ").toLowerCase(),
            enquiry.notes.length ? `${enquiry.notes.length} ${enquiry.notes.length === 1 ? "note" : "notes"}` : "no notes",
          ].join(" · ")}
          defaultOpen={false}
          bodyClassName=""
        >
          <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
            {[
              ["What they asked about", [enquiry.interestCountry, enquiry.interestPathway].filter(Boolean).join(" · ") || "Not recorded"],
              ["Intake", enquiry.intakeMonth || enquiry.intakeYear ? `${enquiry.intakeMonth ?? ""} ${enquiry.intakeYear ?? ""}`.trim() : "Not recorded"],
              ["Budget they gave", enquiry.budgetLakhs ? `${enquiry.budgetLakhs} lakh` : "Not recorded"],
              ["Where they came from", enquiry.source.replace(/_/g, " ").toLowerCase()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          {enquiry.answers.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted">What the branch asked them</p>
              <ul className="space-y-1.5 text-sm">
                {enquiry.answers.map((a, i) => (
                  <li key={i}>
                    <span className="text-muted">{a.question}</span> {a.answer}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {enquiry.notes.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {enquiry.notes.map((n) => (
                <li key={n.id} className="px-4 py-2.5 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-0.5 text-xs text-muted">{fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}

          {enquiry.notes.length === 0 && enquiry.answers.length === 0 && (
            <p className="border-t border-line px-4 py-3 text-sm text-muted">
              Nothing was written down on the enquiry beyond what it asked for.
            </p>
          )}
        </Section>
      )}

      {mayMoveBranch && (
        <Section id="branch" title="Branch" meta={`${student.org.name} · Move to another branch`} defaultOpen={false}>
          <p className="mb-3 text-sm text-muted">
            For a student registered at the wrong branch. They move with their applications and enquiries, and the counsellor is somebody at the new branch
            or nobody, for its branch head to hand out.
          </p>
          <StudentMoveForm
            action={moveStudentAction}
            hidden={{ studentId: id }}
            branches={moveTargets}
            keeps={MOVE_KEEPS(student.org.name)}
            submitLabel="Move to this branch"
            what={student.firstName}
          />
        </Section>
      )}

      {(staffHere || mayAssign || leadsTeam) && (
        <Section
          id="team"
          title={staffHere ? "Team and who is on this file" : "Who is on this file"}
          meta={[
            ...(staffHere ? [student.teamId ? teams.find((t) => t.id === student.teamId)?.name ?? "A retired team" : "No team"] : []),
            onFile.length === 0 ? "nobody else named" : `${onFile.length} ${onFile.length === 1 ? "person" : "people"} besides the counsellor`,
          ].join(" · ")}
          defaultOpen={staffHere ? !student.teamId : onFile.length > 0}
          bodyClassName=""
        >
          {staffHere && (
          <form action={setStudentTeamAction} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
            <input type="hidden" name="studentId" value={id} />
            <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Team carrying this file
              <select
                name="teamId"
                defaultValue={student.teamId ?? ""}
                disabled={!mayAssign}
                className="mt-1 block w-52 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm"
              >
                <option value="">No team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            {mayAssign && <Button variant="secondary" size="sm">Save</Button>}
            <p className="w-full text-2xs text-muted">
              Which part of the business carries this student: Ausbildung, Austria, the UK desk. The queues can be read one team at a time.
            </p>
          </form>
          )}

          {leadsTeam && student.team && (
            <div className="border-b border-line px-4 py-3">
              <GiveToTeamMemberForm
                studentId={id}
                teamName={student.team.name}
                members={teamMembers}
                current={onFile.find((r) => r.part === "Team" && teamMembers.some((m) => m.id === r.userId))?.userId ?? ""}
              />
            </div>
          )}

          <ul className="divide-y divide-line">
            {onFile.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">
                Only the counsellor this file is assigned to. Add whoever else is working on it, and what they do.
              </li>
            )}
            {onFile.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="font-medium">{row.user?.deskLabel ?? row.user?.name}</span>
                <Chip tone="info">{row.part}</Chip>
                <span className="text-xs text-muted">{ROLE_LABEL[row.user?.role ?? ""] ?? row.user?.role}</span>
                {row.user?.department && <span className="text-xs text-muted">{row.user.department}</span>}
                {row.user && !row.user.active && <Chip tone="warn">No longer active</Chip>}
                {mayAssign && (
                  <form action={removePersonFromFileAction} className="ml-auto">
                    <input type="hidden" name="personId" value={row.id} />
                    <button className="text-xs text-muted hover:text-stop-500">Take off the file</button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {mayAssign && (
            <div className="border-t border-line px-4 py-3">
              <AddPersonForm studentId={id} people={staff} />
            </div>
          )}
        </Section>
      )}

      <Section id="personal" title="Personal information" state={state.personal} defaultOpen={wants(state.personal)}>
        {!showFull && student.passportNumber && (
          <form action={revealPassportAction} className="mb-3 flex items-center justify-end gap-2 text-xs text-muted">
            <input type="hidden" name="studentId" value={id} />
            Passport number is masked. Viewing the full number is logged.
            <Button variant="quiet" className="px-2 py-1 text-xs">Reveal</Button>
          </form>
        )}
        <PersonalForm student={pickProfile(student)} passportDisplay={passportDisplay} disabled={readOnly} />
      </Section>

      <Section id="academics" title="Academic qualifications" state={state.academics} defaultOpen={wants(state.academics)}>
        <RowList
          empty="No qualifications added yet."
          rows={academics.map((a) => ({ id: a.id, title: `${LEVEL[a.level]}: ${a.course ?? ""}`, sub: `${a.institution}${a.score != null ? ` · ${a.score}${a.gradingSystem === "percentage" ? "%" : ""}` : ""}${a.yearCompleted ? ` · ${a.yearCompleted}` : ""}` }))}
          kind="academic" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><AcademicForm studentId={id} /></div>}
      </Section>

      <Section id="work" title={<>Work experience <span className="text-xs font-normal text-muted">(optional)</span></>} state={state.work} defaultOpen={wants(state.work)}>
        <RowList
          empty="No work experience added."
          rows={work.map((w) => ({ id: w.id, title: `${w.title}, ${w.employer}`, sub: `${fmtDate(w.startDate)} to ${w.endDate ? fmtDate(w.endDate) : "present"}` }))}
          kind="work" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><WorkForm studentId={id} /></div>}
      </Section>

      <Section id="tests" title="Tests" state={state.tests} defaultOpen={wants(state.tests)}>
        <RowList
          empty="No test scores added."
          rows={tests.map((t) => {
            // The sections are the whole reason this is here: a university that
            // wants 6.0 in writing is not answered by an overall 6.5.
            const sections = [
              t.listening && `L ${t.listening}`,
              t.reading && `R ${t.reading}`,
              t.writing && `W ${t.writing}`,
              t.speaking && `S ${t.speaking}`,
            ].filter(Boolean).join(" · ");
            const waiting = t.state !== "TAKEN";
            const name = t.test === "GERMAN" ? "German" : t.test;
            return {
              id: t.id,
              title: waiting ? name : `${name} ${t.overall ?? ""}`.trim(),
              sub: [
                waiting ? (t.state === "BOOKED" ? "Booked, waiting for the result" : "Not taken yet") : t.isMock ? "Practice test from Medcity LMS" : "Official result",
                sections || null,
                t.takenOn ? fmtDate(t.takenOn) : null,
              ].filter(Boolean).join(" · "),
              badge: waiting ? "No score yet" : t.isMock ? "Mock" : undefined,
            };
          })}
          kind="test" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><TestForm studentId={id} /></div>}
      </Section>

      <Section id="background" title="Background" state={state.background} defaultOpen={wants(state.background)}>
        <p className="mb-3 text-sm text-muted">Institutions and visa forms ask these of every applicant. Answer once here; a yes needs the details.</p>
        {readOnly ? (
          <ul className="space-y-2 text-md">
            {BACKGROUND_QUESTIONS.map((q) => {
              const a = student.background[q.key];
              return (
                <li key={q.key}>
                  <p>{q.text}</p>
                  <p className="text-muted">{a ? (a.answer ? `Yes: ${a.details}` : "No") : "Not answered"}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <BackgroundForm studentId={id} answers={student.background} disabled={false} />
        )}
      </Section>

      <Section id="contacts" title={<>Important contacts <span className="text-xs font-normal text-muted">(parents, guardians, sponsor)</span></>} state={state.contacts} defaultOpen={wants(state.contacts)}>
        <RowList
          empty="No contacts added."
          rows={contacts.map((c) => ({ id: c.id, title: `${c.name} (${c.relation})`, sub: [c.phone, c.email].filter(Boolean).join(" · "), badge: c.emergency ? "Emergency" : undefined }))}
          kind="contact" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><ContactForm studentId={id} /></div>}
      </Section>
    </div>
  );
}

function RowList({ rows, empty, kind, studentId, canDelete }: { rows: { id: string; title: string; sub: string; badge?: string }[]; empty: string; kind: string; studentId: string; canDelete: boolean }) {
  if (!rows.length) return <p className="text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div>
            <p className="font-medium">{r.title} {r.badge && <Chip tone="info">{r.badge}</Chip>}</p>
            <p className="text-xs text-muted">{r.sub}</p>
          </div>
          {canDelete && (
            <form action={deleteProfileRowAction}>
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="rowId" value={r.id} />
              <button className="text-xs text-muted hover:text-stop-500">Remove</button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Only plain profile fields go to the client form (never related user records). */
function pickProfile(s: typeof schema.students.$inferSelect) {
  const { id, firstName, lastName, email, phone, dateOfBirth, gender, maritalStatus, nationality, addressLine1, addressLine2, city, state, pincode, passportIssue, passportExpiry, passportIssueCountry, cityOfBirth, backlogs, gapYears, preferredLanguage, whatsappOptIn, mailingSameAsPermanent, mailingAddress, otherCitizenship, livingInCountry } = s;
  return { id, firstName, lastName, email, phone, dateOfBirth, gender, maritalStatus, nationality, addressLine1, addressLine2, city, state, pincode, passportIssue, passportExpiry, passportIssueCountry, cityOfBirth, backlogs, gapYears, preferredLanguage, whatsappOptIn, mailingSameAsPermanent, mailingAddress, otherCitizenship, livingInCountry };
}
