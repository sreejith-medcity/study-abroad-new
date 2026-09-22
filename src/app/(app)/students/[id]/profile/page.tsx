import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { profileCompleteness } from "@/lib/checks";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { APP_ROLES, canSeeFullPassport, isAdmin, maskPassport } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { Alert, Button, Card, Chip } from "@/components/ui";
import { deleteProfileRowAction, revealPassportAction, toggleLockAction, togglePortalAccessAction } from "../../actions";
import { AcademicForm, BackgroundForm, ContactForm, PersonalForm, PortalInviteForm, RequestEditForm, TestForm, WorkForm } from "./forms";
import { BACKGROUND_QUESTIONS, backgroundComplete } from "@/lib/background";
import { aiFeatureOn } from "@/server/ai";
import { AutofillPanel } from "./autofill";

export const metadata = { title: "Student profile" };

const LEVEL = { SCHOOL: "Std. 12th / school", UG_DIPLOMA: "Diploma", UG: "Bachelor's", PG_DIPLOMA: "PG diploma", PG: "Master's", PHD: "PhD", VOCATIONAL: "Vocational", REGISTRATION: "Registration", CERTIFICATE: "Certificate" } as const;

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reveal?: string }> }) {
  const { id } = await params;
  const { reveal } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [academics, tests, work, openRequests, portalAccount, contacts] = await Promise.all([
    db.select().from(schema.academicRecords).where(eq(schema.academicRecords.studentId, id)).orderBy(asc(schema.academicRecords.yearCompleted)),
    db.select().from(schema.testScores).where(eq(schema.testScores.studentId, id)),
    db.select().from(schema.workExperience).where(eq(schema.workExperience.studentId, id)).orderBy(asc(schema.workExperience.startDate)),
    db.select().from(schema.editRequests).where(and(eq(schema.editRequests.studentId, id), eq(schema.editRequests.status, "OPEN"))),
    db.query.users.findFirst({ where: eq(schema.users.studentId, id) }),
    db.select().from(schema.studentContacts).where(eq(schema.studentContacts.studentId, id)).orderBy(asc(schema.studentContacts.createdAt)),
  ]);

  const autofill = await aiFeatureOn("autofill");
  const readable = autofill
    ? await db.query.documents.findMany({
        where: and(eq(schema.documents.studentId, id), inArray(schema.documents.typeCode, ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "DEGREE_CERTIFICATE", "ENGLISH_TEST"])),
        with: { type: { columns: { label: true } } },
        orderBy: desc(schema.documents.createdAt),
        limit: 8,
      })
    : [];
  const done = profileCompleteness({ ...student, academics, tests, documentTypeCodes: [] });
  const readOnly = user.role === "MANAGEMENT" || (student.profileLocked && !isAdmin(user));
  const showFull = canSeeFullPassport(user) || reveal === "1";
  const passportDisplay = showFull ? student.passportNumber ?? "" : maskPassport(student.passportNumber);

  const sections = [
    { href: "#personal", label: "Personal information", state: done.personal ? "Complete" : "Incomplete" },
    { href: "#academics", label: "Academic qualifications", state: done.academics ? "Complete" : "Incomplete" },
    { href: "#work", label: "Work experience", state: work.length ? "Complete" : "Optional" },
    { href: "#tests", label: "Tests", state: done.tests ? "Complete" : "Incomplete" },
    { href: "#background", label: "Background", state: backgroundComplete(student.background) ? "Complete" : "Incomplete" },
    { href: "#contacts", label: "Contacts", state: contacts.length ? "Complete" : "Optional" },
  ];

  return (
    <div className="space-y-5">
      <Card className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-3 xl:grid-cols-6">
        {sections.map((s) => (
          <a key={s.href} href={s.href} className="bg-white px-4 py-3 text-center hover:bg-ground">
            <p className="font-medium">{s.label}</p>
            <p className={s.state === "Complete" ? "text-xs text-emerald-700" : s.state === "Optional" ? "text-xs text-muted" : "text-xs text-red-600"}>{s.state}</p>
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
        <Card className="border-amber-300 p-4">
          <h2 className="font-semibold">Open edit requests</h2>
          <ul className="mt-2 space-y-1">
            {openRequests.map((r) => <li key={r.id}><Chip tone="warn">{r.section}</Chip> {r.message} <span className="text-xs text-muted">{fmtDateTime(r.createdAt)}</span></li>)}
          </ul>
        </Card>
      )}
      {student.profileLocked && (user.role === "PARTNER" || user.role === "COUNSELLOR") && (
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
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
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

      {autofill && !readOnly && readable.length > 0 && (
        <Card className="p-4" id="autofill">
          <h2 className="font-semibold">Fill from a document</h2>
          <p className="mb-3 text-[13px] text-muted">The file is sent to an AI service to be read. You check what it found before anything is saved.</p>
          <AutofillPanel studentId={id} docs={readable.map((d) => ({ id: d.id, label: d.type?.label ?? d.fileName }))} />
        </Card>
      )}

      <Card id="personal" className="scroll-mt-20 p-5">
        {!showFull && student.passportNumber && (
          <form action={revealPassportAction} className="mb-3 flex items-center justify-end gap-2 text-xs text-muted">
            <input type="hidden" name="studentId" value={id} />
            Passport number is masked. Viewing the full number is logged.
            <Button variant="quiet" className="px-2 py-1 text-xs">Reveal</Button>
          </form>
        )}
        <PersonalForm student={pickProfile(student)} passportDisplay={passportDisplay} disabled={readOnly} />
      </Card>

      <Card id="academics" className="scroll-mt-20 p-5">
        <h2 className="mb-3 font-semibold text-brand-700">Academic qualifications</h2>
        <RowList
          empty="No qualifications added yet."
          rows={academics.map((a) => ({ id: a.id, title: `${LEVEL[a.level]}: ${a.course ?? ""}`, sub: `${a.institution}${a.score != null ? ` · ${a.score}${a.gradingSystem === "percentage" ? "%" : ""}` : ""}${a.yearCompleted ? ` · ${a.yearCompleted}` : ""}` }))}
          kind="academic" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><AcademicForm studentId={id} /></div>}
      </Card>

      <Card id="work" className="scroll-mt-20 p-5">
        <h2 className="mb-3 font-semibold text-brand-700">Work experience <span className="text-xs font-normal text-muted">(optional)</span></h2>
        <RowList
          empty="No work experience added."
          rows={work.map((w) => ({ id: w.id, title: `${w.title}, ${w.employer}`, sub: `${fmtDate(w.startDate)} to ${w.endDate ? fmtDate(w.endDate) : "present"}` }))}
          kind="work" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><WorkForm studentId={id} /></div>}
      </Card>

      <Card id="tests" className="scroll-mt-20 p-5">
        <h2 className="mb-3 font-semibold text-brand-700">Tests</h2>
        <RowList
          empty="No test scores added."
          rows={tests.map((t) => ({ id: t.id, title: `${t.test === "GERMAN" ? "German" : t.test} ${t.overall}`, sub: `${t.isMock ? "Practice test from Medcity LMS" : "Official result"}${t.takenOn ? ` · ${fmtDate(t.takenOn)}` : ""}`, badge: t.isMock ? "Mock" : undefined }))}
          kind="test" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><TestForm studentId={id} /></div>}
      </Card>

      <Card id="background" className="scroll-mt-20 p-5">
        <h2 className="font-semibold text-brand-700">Background</h2>
        <p className="mb-3 text-[13px] text-muted">Institutions and visa forms ask these of every applicant. Answer once here; a yes needs the details.</p>
        {readOnly ? (
          <ul className="space-y-2 text-sm">
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
      </Card>

      <Card id="contacts" className="scroll-mt-20 p-5">
        <h2 className="mb-3 font-semibold text-brand-700">Important contacts <span className="text-xs font-normal text-muted">(parents, guardians, sponsor)</span></h2>
        <RowList
          empty="No contacts added."
          rows={contacts.map((c) => ({ id: c.id, title: `${c.name} (${c.relation})`, sub: [c.phone, c.email].filter(Boolean).join(" · "), badge: c.emergency ? "Emergency" : undefined }))}
          kind="contact" studentId={id} canDelete={!readOnly}
        />
        {!readOnly && <div className="mt-4 border-t border-line pt-4"><ContactForm studentId={id} /></div>}
      </Card>
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
              <button className="text-xs text-muted hover:text-red-600">Remove</button>
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
