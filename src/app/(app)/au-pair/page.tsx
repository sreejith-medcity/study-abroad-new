import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, istDateTime } from "@/lib/format";
import { STUDENT_WORK_ROLES } from "@/lib/permissions";
import { AU_PAIR_STEPS, AU_PAIR_STEP_COUNT, AU_PAIR_TEAMS, AU_PAIR_TEAM_LABEL, type AuPairTeam } from "@/lib/au-pair";
import { auPairContacts, auPairTrackerRows, type AuPairTrackerRow } from "@/server/au-pair";
import { fsjBranchChoices } from "@/server/fsj";
import { FilterBar } from "@/components/filter-bar";
import { OwnFilesNote } from "@/components/own-files-note";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Au pair tracker" };
export const dynamic = "force-dynamic";

/** Reading choices for "at this step for at least", not turnarounds: the guide sets none. */
const STUCK = [7, 14, 30, 60];

/**
 * Every Au pair file this person may see, one row each, placed on the
 * guide's 15 steps: which team owns the file now, how long it has sat at its
 * step, the mentor, the host family and the visa. Filterable by step, team,
 * branch and the days at the step, as the FSJ / BFD tracker is.
 */
export default async function AuPairTrackerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser([...STUDENT_WORK_ROLES, "MANAGEMENT"]);
  const sp = await searchParams;
  const step = Number(sp.step);
  const stuck = Number(sp.stuck);
  const filters = {
    q: sp.q,
    org: sp.branch,
    of: sp.of,
    step: Number.isInteger(step) && step >= 1 && step <= AU_PAIR_STEP_COUNT ? step : undefined,
    team: AU_PAIR_TEAMS.some((d) => d.key === sp.team) ? (sp.team as AuPairTeam) : undefined,
    stuck: Number.isInteger(stuck) && stuck >= 0 && stuck <= 3650 ? stuck : undefined,
  };
  const [rows, orgs, contacts] = await Promise.all([auPairTrackerRows(user, filters), fsjBranchChoices(user), auPairContacts()]);

  return (
    <>
      <PageHeader title="Au pair tracker" subtitle="Au pair files on the written process: step, the team that owns it, and how long each has sat there." />
      <OwnFilesNote of={sp.of} viewer={user} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/ausbildung" className="rounded-full border border-line-strong px-3.5 py-1.5 font-medium text-ink-soft hover:bg-surface-2">
          Placement tracker
        </Link>
        <Link href="/fsj" className="rounded-full border border-line-strong px-3.5 py-1.5 font-medium text-ink-soft hover:bg-surface-2">
          FSJ / BFD
        </Link>
        <span className="rounded-full border border-brand-600 bg-brand-600 px-3.5 py-1.5 font-medium text-white" aria-current="page">
          Au pair
        </span>
      </div>

      <FilterBar
        primary={5}
        keep={["of"]}
        fields={[
          { kind: "search", name: "q", label: "Student", placeholder: "Name, Medcity ID or phone" },
          { kind: "select", name: "step", label: "Step", options: AU_PAIR_STEPS.map((s) => ({ value: String(s.step), label: `${s.step}. ${s.title}` })) },
          { kind: "select", name: "team", label: "Team", options: AU_PAIR_TEAMS.map((d) => ({ value: d.key, label: d.label })) },
          ...(orgs.length > 1 ? [{ kind: "select" as const, name: "branch", label: "Branch", options: orgs.map((o) => ({ value: o.id, label: o.name })) }] : []),
          { kind: "select", name: "stuck", label: "At this step for", options: STUCK.map((d) => ({ value: String(d), label: `${d} days or more` })) },
        ]}
      >
        <span className="pb-2 text-xs text-muted">
          {rows.length} {rows.length === 1 ? "student" : "students"}
        </span>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No Au pair files here">Widen the filters, or register a student for Au pair.</EmptyState>
      ) : (
        <Card>
          <Table tableClassName="min-w-[1100px]">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Branch and counsellor</Th>
                <Th>Step</Th>
                <Th>Team</Th>
                <Th>At this step</Th>
                <Th>Mentor</Th>
                <Th>Host family</Th>
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

      <Card className="mt-4 p-4" data-au-pair-contacts>
        <h2 className="font-semibold text-brand-700">Registration email address</h2>
        <p className="mb-3 text-xs text-muted">
          The guide has the counsellor email the Documentation Team here at registration, and tell them on WhatsApp. The portal does not send it; the branch does.{" "}
          {contacts.fromList ? "Kept on the Contacts list." : "From the guide, until the Contacts list carries it."}
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

function Row({ r }: { r: AuPairTrackerRow }) {
  const app = r.app;
  return (
    <tr data-au-pair-row={r.id} data-step={r.step?.step ?? ""} data-team={r.team ?? ""}>
      <Td>
        <Link href={`/students/${r.id}/au-pair`} className="font-medium text-ink hover:text-brand-700 hover:underline">
          {fullName(r)}
        </Link>
        <span className="block text-xs text-muted">{r.medcityId ?? "No Medcity ID"}</span>
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
          <span className="text-muted">No Au pair application yet</span>
        )}
      </Td>
      <Td>{r.team ? AU_PAIR_TEAM_LABEL[r.team] : <span className="text-muted">Not placed</span>}</Td>
      <Td className="tabular">
        <span data-days={r.days ?? ""}>{r.days != null ? `${r.days} ${r.days === 1 ? "day" : "days"}` : <span className="text-muted">Not recorded</span>}</span>
      </Td>
      <Td>{r.mentor ?? <span className="text-muted">Not assigned</span>}</Td>
      <Td>
        {app?.hostFamily ? (
          <>
            {app.hostFamily}
            {app.interviewAt && <span className="block text-xs text-muted">Interview {istDateTime(app.interviewAt)}</span>}
            {app.contractSignedOn && <span className="block text-xs text-muted">Contract signed {fmtDate(app.contractSignedOn)}</span>}
          </>
        ) : (
          <span className="text-muted">None in hand</span>
        )}
      </Td>
      <Td>
        {app?.visaDecision === "GRANTED" ? (
          `Approved ${fmtDate(app.visaDecisionOn)}`
        ) : app?.visaDecision === "REFUSED" ? (
          "Refused"
        ) : app?.visaLodgedOn ? (
          `Submitted ${fmtDate(app.visaLodgedOn)}`
        ) : app?.appointmentAt ? (
          `Appointment ${fmtDate(app.appointmentAt)}`
        ) : (
          <span className="text-muted">Not yet</span>
        )}
      </Td>
    </tr>
  );
}
