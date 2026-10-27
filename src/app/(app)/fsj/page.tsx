import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, istDateTime } from "@/lib/format";
import { STUDENT_WORK_ROLES } from "@/lib/permissions";
import { FSJ_DEPARTMENTS, FSJ_DEPARTMENT_LABEL, FSJ_STEPS, FSJ_STEP_COUNT, ownersText, type FsjDepartment, type FsjPathway } from "@/lib/fsj";
import { fsjBranchChoices, fsjContacts, fsjTrackerRows, type FsjTrackerRow } from "@/server/fsj";
import { FilterBar } from "@/components/filter-bar";
import { OwnFilesNote } from "@/components/own-files-note";
import { Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";

export const metadata = { title: "FSJ and BFD tracker" };
export const dynamic = "force-dynamic";

/** Reading choices for "at this step for at least", not turnarounds: the guide sets none. */
const STUCK = [7, 14, 30, 60];

/**
 * Every FSJ and BFD file this person may see, one row each, placed on the
 * guide's 18 steps: which department owns the file now, how long it has sat
 * at its step, the language result, the interview and the visa. Filterable by
 * step, owner department, branch and the days at the step.
 */
export default async function FsjTrackerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser([...STUDENT_WORK_ROLES, "MANAGEMENT"]);
  const sp = await searchParams;
  const step = Number(sp.step);
  const stuck = Number(sp.stuck);
  const filters = {
    q: sp.q,
    org: sp.branch,
    of: sp.of,
    step: Number.isInteger(step) && step >= 1 && step <= FSJ_STEP_COUNT ? step : undefined,
    dept: FSJ_DEPARTMENTS.some((d) => d.key === sp.dept) ? (sp.dept as FsjDepartment) : undefined,
    stuck: Number.isInteger(stuck) && stuck >= 0 && stuck <= 3650 ? stuck : undefined,
    programme: sp.programme === "FSJ" || sp.programme === "BFD" ? (sp.programme as FsjPathway) : undefined,
    hold: sp.hold === "1",
  };
  const [rows, orgs, contacts] = await Promise.all([fsjTrackerRows(user, filters), fsjBranchChoices(user), fsjContacts()]);

  return (
    <>
      <PageHeader title="FSJ and BFD tracker" subtitle="Freiwilliges Soziales Jahr and Bundesfreiwilligendienst files on the written process: step, owner department, and how long each has sat there." />
      <OwnFilesNote of={sp.of} viewer={user} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/ausbildung" className="rounded-full border border-line-strong px-3.5 py-1.5 font-medium text-ink-soft hover:bg-surface-2">
          Placement tracker
        </Link>
        <span className="rounded-full border border-brand-600 bg-brand-600 px-3.5 py-1.5 font-medium text-white" aria-current="page">
          FSJ / BFD
        </span>
        {filters.hold && <span className="text-xs text-muted">Showing applications on hold for the fee.</span>}
      </div>

      <FilterBar
        primary={6}
        keep={["of"]}
        fields={[
          { kind: "search", name: "q", label: "Student", placeholder: "Name, Medcity ID or phone" },
          { kind: "select", name: "step", label: "Step", options: FSJ_STEPS.filter((s) => s.statusCodes.length).map((s) => ({ value: String(s.step), label: `${s.step}. ${s.title}` })) },
          { kind: "select", name: "dept", label: "Owner department", options: FSJ_DEPARTMENTS.map((d) => ({ value: d.key, label: d.label })) },
          ...(orgs.length > 1 ? [{ kind: "select" as const, name: "branch", label: "Branch", options: orgs.map((o) => ({ value: o.id, label: o.name })) }] : []),
          { kind: "select", name: "stuck", label: "At this step for", options: STUCK.map((d) => ({ value: String(d), label: `${d} days or more` })) },
          { kind: "select", name: "programme", label: "Programme", options: [{ value: "FSJ", label: "FSJ" }, { value: "BFD", label: "BFD" }] },
        ]}
      >
        <span className="pb-2 text-xs text-muted">
          {rows.length} {rows.length === 1 ? "student" : "students"}
        </span>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No FSJ or BFD files here">Widen the filters, or register a student for FSJ or BFD.</EmptyState>
      ) : (
        <Card>
          <Table tableClassName="min-w-[1180px]">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Branch and counsellor</Th>
                <Th>Step</Th>
                <Th>Owner department</Th>
                <Th>At this step</Th>
                <Th>Language</Th>
                <Th>Interview</Th>
                <Th>Visa</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mt-4 p-4" data-fsj-contacts>
        <h2 className="font-semibold text-brand-700">Registration email addresses</h2>
        <p className="mb-3 text-xs text-muted">
          The guide has the counsellor email the candidate&apos;s details here at registration, with the branch head in copy. The portal does not send it; the branch does.{" "}
          {contacts.fromList ? "Kept on the Contacts list." : "From the guide, until the Contacts list carries them."}
        </p>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {contacts.rows.map((c) => (
            <li key={c.id} className="rounded-lg border border-line px-3 py-2">
              <p className="font-medium text-ink">{c.name}</p>
              {c.title && <p className="text-xs text-muted">{c.title}</p>}
              {c.email && <span className="break-all text-xs font-medium text-brand-600">{c.email}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Row({ r }: { r: FsjTrackerRow }) {
  const app = r.app;
  return (
    <tr data-fsj-row={r.id} data-step={r.step?.step ?? ""} data-dept={r.department ?? ""}>
      <Td>
        <Link href={`/students/${r.id}/fsj`} className="font-medium text-ink hover:text-brand-700 hover:underline">
          {fullName(r)}
        </Link>
        <span className="block text-xs text-muted">
          {r.medcityId ?? "No Medcity ID"}
          {r.programme ? ` · ${r.programme}` : ""}
        </span>
      </Td>
      <Td>
        {r.branch}
        <span className="block text-xs text-muted">{r.counsellor ?? "No counsellor"}</span>
      </Td>
      <Td>
        {app ? (
          r.step ? (
            <>
              <span className="font-medium">
                {r.step.step}. {r.step.title}
              </span>
              <span className="block text-xs text-muted">{app.statusLabel}</span>
            </>
          ) : (
            app.statusLabel
          )
        ) : (
          <span className="text-muted">No FSJ / BFD application yet</span>
        )}
      </Td>
      <Td>
        {r.department ? FSJ_DEPARTMENT_LABEL[r.department] : <span className="text-muted">Not placed</span>}
        {r.step && <span className="block text-xs text-muted">{ownersText(r.step)}</span>}
      </Td>
      <Td className="tabular">
        <span data-days={r.days ?? ""}>{r.days != null ? `${r.days} ${r.days === 1 ? "day" : "days"}` : <span className="text-muted">Not recorded</span>}</span>
      </Td>
      <Td>
        {app?.languageResult ? (
          <span className={cn(app.languageResult === "NOT_SUFFICIENT" && "text-warn-700")}>
            {app.languageLevel}: {app.languageResult === "SUFFICIENT" ? "sufficient" : "not sufficient"}
          </span>
        ) : (
          <span className="text-muted">Not assessed</span>
        )}
      </Td>
      <Td>
        {app?.employer ? (
          <>
            {app.employer}
            {app.interviewAt && <span className="block text-xs text-muted">{istDateTime(app.interviewAt)}</span>}
          </>
        ) : (
          <span className="text-muted">None in hand</span>
        )}
      </Td>
      <Td>
        {app?.visaDecision === "GRANTED"
          ? `Approved ${fmtDate(app.visaDecisionOn)}`
          : app?.visaDecision === "REFUSED"
            ? "Refused"
            : app?.visaLodgedOn
              ? `Submitted ${fmtDate(app.visaLodgedOn)}`
              : app?.vfsSlotOn
                ? `VFS slot ${fmtDate(app.vfsSlotOn)}`
                : <span className="text-muted">Not yet</span>}
      </Td>
    </tr>
  );
}
