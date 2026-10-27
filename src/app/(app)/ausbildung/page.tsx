import { AUSBILDUNG_DEPARTMENTS, DEPARTMENT_LABEL, beforeTheDesk, chargeMoney, milestoneDueAt, percentPaid, tatStanding, tatText, type AusbildungDepartment } from "@/lib/ausbildung";
import { IconClock } from "@/components/icons";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, istTime } from "@/lib/format";
import { STUDENT_WORK_ROLES, isStaff } from "@/lib/permissions";
import { AUSBILDUNG_GUIDE, guideHref, mayReadGuide } from "@/lib/staff-guides";
import { NCLEX_STATES } from "@/lib/nclex";
import { ausbildungContacts, chargingCountries, overTurnaroundCount, trackerChoices, trackerRows, type TrackerRow, type TrackerShow, type TrackerTab } from "@/server/ausbildung";
import { commissionVisible } from "@/server/commission-visibility";
import { FilterBar } from "@/components/filter-bar";
import { OwnFilesNote } from "@/components/own-files-note";
import { Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";

export const metadata = { title: "Placement tracker" };
export const dynamic = "force-dynamic";

const SHOW: { value: TrackerShow; label: string }[] = [
  { value: "interview", label: "Interview coming up" },
  { value: "contract", label: "Contract received" },
  { value: "german", label: "German not finished" },
  { value: "unpaid", label: "Service charge pending" },
  { value: "over", label: "Over turnaround" },
];

/**
 * Every Ausbildung student, and everybody bound for a country that collects a
 * service charge, one row each.
 *
 * The questions asked of these files every week are the same ones: when did
 * they register and with which branch and counsellor, how far are they in
 * German, what did they apply for, when is the interview, has the contract
 * come, and has the service charge been paid. Each of those was somewhere on
 * the file, on four different tabs. This is all of them in a row, for every
 * such student at once, and the name opens the file where each one is set.
 */
export default async function AusbildungTrackerPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser([...STUDENT_WORK_ROLES, "MANAGEMENT"]);
  const sp = await searchParams;
  const tab: TrackerTab = sp.tab === "service" ? "service" : sp.tab === "nclex" ? "nclex" : "ausbildung";
  // "Over turnaround" reads the written process's steps, which only the Ausbildung tab has.
  const show = SHOW.some((s) => s.value === sp.show) && !(sp.show === "over" && tab !== "ausbildung") ? (sp.show as TrackerShow) : undefined;
  // The desk filter belongs to the Ausbildung tab alone: the written process
  // is Ausbildung's, and the other tabs have no statuses it places.
  const department = tab === "ausbildung" && AUSBILDUNG_DEPARTMENTS.some((d) => d.key === sp.dept) ? (sp.dept as AusbildungDepartment) : undefined;
  const [rows, choices, money, charging, contacts, over] = await Promise.all([
    // "of" is one person's own files, the way a dashboard's figures link
    // here; "who" is the counsellor named on the file, the bar's own picker.
    trackerRows(user, { tab, org: sp.branch, counsellor: sp.who, of: sp.of, q: sp.q, show, department }),
    trackerChoices(user),
    commissionVisible(user),
    chargingCountries(),
    tab === "ausbildung" ? ausbildungContacts() : Promise.resolve(null),
    // The written process is Ausbildung's, so the turnaround tile is too.
    tab === "ausbildung" ? overTurnaroundCount(user) : Promise.resolve(null),
  ]);
  const staff = isStaff(user);

  const tabHref = (t: TrackerTab) => `/ausbildung${t === "ausbildung" ? "" : `?tab=${t}`}`;

  return (
    <>
      <PageHeader
        title="Placement tracker"
        subtitle="Ausbildung, NCLEX-RN (USA) and every student bound for a service-charge country, with where each one stands."
        actions={
          tab === "ausbildung" && mayReadGuide(AUSBILDUNG_GUIDE, user.role, isStaff(user)) ? (
            // The staff guide on the written process, in the learning library,
            // offered only to the roles the guide is written for.
            <Link href={guideHref("ausbildung-process")} data-how-this-works className="text-sm font-medium text-brand-600 hover:underline">
              How this works
            </Link>
          ) : undefined
        }
      />
      <OwnFilesNote of={sp.of} viewer={user} />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Which students">
        {(
          [
            ["ausbildung", "Ausbildung"],
            ["nclex", "NCLEX-RN (USA)"],
            ["service", "Service-charge countries"],
          ] as const
        ).map(([t, label]) => (
          <Link
            key={t}
            href={tabHref(t)}
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium",
              tab === t ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:bg-surface-2",
            )}
          >
            {label}
          </Link>
        ))}
        {/* FSJ and BFD have their own written process and their own tracker. */}
        <Link href="/fsj" className="rounded-full border border-line-strong px-3.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2" data-fsj-tracker-link>
          FSJ / BFD
        </Link>
        {/* Au pair too. */}
        <Link href="/au-pair" className="rounded-full border border-line-strong px-3.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-surface-2" data-au-pair-tracker-link>
          Au pair
        </Link>
        {tab === "service" && (
          <span className="text-xs text-muted">
            {charging.length
              ? `Ticked: ${charging.map((c) => c.name).join(", ")}.`
              : "No country is ticked yet."}{" "}
            {staff && (
              <Link href="/admin/destinations#service-charge" className="font-medium text-brand-600 hover:underline">
                Change which countries
              </Link>
            )}
          </span>
        )}
      </div>

      {over != null && <OverTurnaroundTile count={over} active={show === "over"} />}

      <FilterBar
        primary={5}
        keep={["of"]}
        fields={[
          { kind: "search", name: "q", label: "Student", placeholder: "Name, Medcity ID or phone" },
          ...(choices.orgs.length > 1 ? [{ kind: "select" as const, name: "branch", label: "Branch", options: choices.orgs.map((o) => ({ value: o.id, label: o.name })) }] : []),
          ...(choices.people.length > 1 ? [{ kind: "select" as const, name: "who", label: "Counsellor", options: choices.people.map((p) => ({ value: p.id, label: p.name })) }] : []),
          ...(tab === "ausbildung"
            ? [{ kind: "select" as const, name: "dept", label: "Desk", options: AUSBILDUNG_DEPARTMENTS.map((d) => ({ value: d.key, label: d.label })) }]
            : []),
          {
            kind: "select" as const,
            name: "show",
            label: "Show",
            // Over turnaround belongs to the Ausbildung tab alone: it reads the written process's steps.
            options: SHOW.filter((s) => (tab === "ausbildung" ? true : tab === "nclex" ? s.value === "unpaid" : s.value === "german" || s.value === "unpaid"))
              .filter((s) => money || s.value !== "unpaid")
              .map((s) => ({ value: s.value, label: s.label })),
          },
        ]}
      >
        <span className="pb-2 text-xs text-muted">
          {rows.length} {rows.length === 1 ? "student" : "students"}
        </span>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title={tab === "ausbildung" ? "No Ausbildung students here" : tab === "nclex" ? "No nursing students here" : "No students bound for a service-charge country"}>
          {tab === "service" && !charging.length
            ? "Tick the countries that collect a service charge under Destinations, and their students appear here."
            : "Widen the filters, or register a student."}
        </EmptyState>
      ) : (
        <Card>
          <Table tableClassName={tab === "ausbildung" ? "min-w-[1280px]" : "min-w-[1080px]"}>
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Registered</Th>
                <Th>Branch and counsellor</Th>
                {tab === "ausbildung" ? <Th>Preferences</Th> : tab === "nclex" ? <Th>Board state</Th> : <Th>Destination</Th>}
                {tab === "nclex" ? <Th>Where they are</Th> : <Th>German</Th>}
                {tab === "ausbildung" && <Th>Desk and step</Th>}
                {tab === "ausbildung" && <Th>Application, interview, contract</Th>}
                {tab === "nclex" && <Th>Result</Th>}
                {money && <Th>Service charge</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} tab={tab} money={money} />
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {contacts && (
        <Card className="mt-4 p-4" data-handovers>
          <h2 className="font-semibold text-brand-700">Hand-overs in the written process</h2>
          <p className="mb-3 text-xs text-muted">
            Where each desk passes a file on, and the address it goes to. The portal does not send these; the desk does.{" "}
            {contacts.fromList ? (
              <>
                Kept on the <Link href="/contacts" className="font-medium text-brand-600 hover:underline">Contacts</Link> list{staff ? ", editable under Admin" : ""}.
              </>
            ) : (
              <>From the written process, until the Contacts list carries them.</>
            )}
          </p>
          <ul className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {contacts.rows.map((c) => (
              <li key={c.id} className="rounded-lg border border-line px-3 py-2">
                <p className="font-medium text-ink">{c.name}</p>
                {c.title && <p className="text-xs text-muted">{c.title}</p>}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="break-all text-xs font-medium text-brand-600 hover:underline">
                    {c.email}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/**
 * How many Ausbildung files have sat at their step longer than the written
 * process allows, as one tile above the filters, which opens the list narrowed
 * to them. Counted by the same rule that colours the step cell, so the figure
 * and the rows it opens agree. A zero is said in words rather than hidden,
 * because "nothing is late" is worth knowing too.
 */
function OverTurnaroundTile({ count, active }: { count: number; active: boolean }) {
  const label = count === 0 ? "No files over their turnaround" : `${count} ${count === 1 ? "file" : "files"} over ${count === 1 ? "its" : "their"} turnaround`;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Link
        href={active ? "/ausbildung" : "/ausbildung?show=over"}
        data-over-turnaround={count}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium shadow-card",
          count > 0 ? (active ? "border-warn-500 bg-warn-50 text-warn-700" : "border-line bg-surface text-warn-700 hover:bg-warn-50") : "border-line bg-surface text-muted",
        )}
      >
        <IconClock className="size-4" aria-hidden="true" />
        {label}
      </Link>
      <span className="text-xs text-muted">{active ? "Showing only those. Click again for every file." : count > 0 ? "Click to show only those." : "Against the written process's turnaround per step."}</span>
    </div>
  );
}

function Row({ r, tab, money }: { r: TrackerRow; tab: TrackerTab; money: boolean }) {
  const prefs = [r.preference1, r.preference2, r.preference3].filter(Boolean) as string[];
  const soon = r.interviewOn && r.interviewOn.getTime() > Date.now() - 86400000 && !r.contractReceivedOn;
  return (
    <tr data-tracker-row={r.id}>
      <Td>
        <Link href={`/students/${r.id}/ausbildung`} className="font-medium text-ink hover:underline">
          {fullName(r)}
        </Link>
        {r.medcityId && <p className="font-mono text-2xs text-muted">{r.medcityId}</p>}
      </Td>
      <Td className="whitespace-nowrap tabular">{fmtDate(r.registeredAt)}</Td>
      <Td>
        <p className="text-sm">{r.branch}</p>
        <p className="text-xs text-muted">{r.counsellor ?? "Nobody assigned"}</p>
      </Td>
      {tab === "ausbildung" ? (
        <Td>
          {prefs.length ? (
            <ol className="space-y-0.5 text-xs">
              {prefs.map((pr, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="font-semibold text-muted">{i + 1}.</span>
                  <span className="max-w-48 truncate" title={pr}>{pr}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="text-xs text-muted">Not recorded</span>
          )}
        </Td>
      ) : tab === "nclex" ? (
        <Td className="text-sm">
          {r.boardState ? (
            <>
              {NCLEX_STATES.find((st) => st.code === r.boardState)?.name ?? r.boardState}
              <p className="text-xs text-muted">${NCLEX_STATES.find((st) => st.code === r.boardState)?.feeUsd}</p>
            </>
          ) : (
            <span className="text-muted">Not chosen</span>
          )}
        </Td>
      ) : (
        <Td className="text-sm">{r.destination ?? <span className="text-muted">Not recorded</span>}</Td>
      )}
      {tab === "nclex" ? (
        <Td className="text-sm">
          {!r.nclexOpened ? (
            <span className="text-muted">Not on the USA placement yet</span>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" aria-hidden="true">
                  <span className="block h-full rounded-full bg-good-500" style={{ width: `${(r.nclex.finished / r.nclex.total) * 100}%` }} />
                </span>
                <span className="text-xs tabular text-muted">
                  {r.nclex.finished} of {r.nclex.total}
                </span>
              </div>
              <p className="mt-1 text-xs">{r.nclex.next ? <>Next: <span className="font-medium">{r.nclex.next.label}</span></> : "Every step done"}</p>
            </>
          )}
        </Td>
      ) : (
      <Td>
        <div className="flex gap-1" aria-label={r.german.incomplete.length ? `German incomplete: ${r.german.incomplete.join(", ")}` : "German complete"}>
          {r.german.levels.map((l) => (
            <span
              key={l.level}
              title={`${l.level}: ${l.state === "COMPLETED" ? "completed" : l.state === "IN_PROGRESS" ? "in progress" : "not started"}`}
              className={cn(
                "rounded px-1.5 py-0.5 text-2xs font-semibold ring-1 ring-inset",
                l.state === "COMPLETED" ? "bg-good-500 text-white ring-good-500" : l.state === "IN_PROGRESS" ? "bg-warn-50 text-warn-700 ring-warn-500/40" : "text-muted ring-line-strong",
              )}
            >
              {l.level}
            </span>
          ))}
        </div>
        {r.german.incomplete.length > 0 && <p className="mt-1 text-2xs text-muted">Incomplete: {r.german.incomplete.join(", ")}</p>}
      </Td>
      )}
      {tab === "nclex" && (
        <Td className="text-sm">
          {r.nclexResult === "PASS" ? (
            <span className="font-medium text-good-700">Pass</span>
          ) : r.nclexResult === "FAIL" ? (
            <span className="font-medium text-stop-700">Fail</span>
          ) : (
            <span className="text-muted">Not in yet</span>
          )}
        </Td>
      )}
      {tab === "ausbildung" && <StepCell r={r} />}
      {tab === "ausbildung" && (
        <Td className="text-sm">
          {/* The three dates the whole thing turns on, in the order they
              happen, one line each, so the column reads down like a timeline. */}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs">
            <dt className="text-muted">Applied</dt>
            <dd>{r.applicationSubmittedOn ? fmtDate(r.applicationSubmittedOn) : <span className="text-muted">Not yet</span>}</dd>
            <dt className="text-muted">Interview</dt>
            <dd className={cn(soon && "font-medium text-warn-700")}>
              {r.interviewOn ? (
                <>
                  {fmtDate(r.interviewOn)} {istTime(r.interviewOn)}
                  {r.interviewWith && <span className="block max-w-56 truncate text-muted" title={r.interviewWith}>{r.interviewWith}</span>}
                </>
              ) : (
                <span className="text-muted">Not scheduled</span>
              )}
            </dd>
            <dt className="text-muted">Contract</dt>
            <dd>
              {r.contractReceivedOn ? (
                <>
                  <span className="font-medium text-good-700">{fmtDate(r.contractReceivedOn)}</span>
                  {r.contractEmployer && <span className="block max-w-56 truncate text-muted" title={r.contractEmployer}>{r.contractEmployer}</span>}
                </>
              ) : (
                <span className="text-muted">Not yet</span>
              )}
            </dd>
          </dl>
        </Td>
      )}
      {money && (
        <Td className="text-sm">
          {!r.charge.any ? (
            <span className="text-muted">Not raised</span>
          ) : (
            r.charge.byCurrency.map((b) => {
              const pending = Math.max(0, b.owed - b.received);
              return (
                <div key={b.currency} className="whitespace-nowrap">
                  <span className="tabular">{chargeMoney(b.received, b.currency)}</span> <span className="text-xs text-muted">received</span>
                  <p className={cn("text-xs", pending > 0 ? "font-medium text-warn-700" : "text-good-700")}>
                    {pending > 0 ? `${chargeMoney(pending, b.currency)} pending` : "Paid in full"}
                  </p>
                </div>
              );
            })
          )}
          {r.charge.unpriced > 0 && <p className="text-2xs text-muted">Amount not recorded</p>}
          {tab === "ausbildung" && <MilestoneLine r={r} />}
        </Td>
      )}
    </tr>
  );
}

/**
 * Which desk the file is with and how long it has sat there, against the
 * turnaround the written process gives that step. Read off the open Ausbildung
 * application's status; a student with no application yet is said so.
 */
function StepCell({ r }: { r: TrackerRow }) {
  if (!r.statusCode) {
    return (
      <Td className="text-sm">
        <span className="text-muted">No Ausbildung application yet</span>
      </Td>
    );
  }
  const tat = tatStanding(r.statusCode, r.statusSince);
  return (
    <Td className="text-sm" data-step={tat.step?.step ?? ""}>
      {r.department && <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{DEPARTMENT_LABEL[r.department]}</p>}
      <p className="font-medium">{r.statusLabel}</p>
      {tat.step ? (
        <p className={cn("text-xs", tat.over ? "font-medium text-warn-700" : "text-muted")}>
          Step {tat.step.step}
          {tat.days != null && `, ${tat.days} ${tat.days === 1 ? "day" : "days"} here`}
          {`; guide: ${tat.step.tatDays ? tatText(tat.step) : tatText(tat.step).toLowerCase()}`}
        </p>
      ) : (
        <p className="text-xs text-muted">Not a step of the written process</p>
      )}
      <MentorLine r={r} />
    </Td>
  );
}

/**
 * Who carries the file at the desk. The mentor's name once one is named; before
 * that, whether the desk has the file at all, because a file handed over at
 * document collection sits with the desk without a mentor until it names one,
 * and that gap is the one the guide gives a same-day turnaround to.
 */
function MentorLine({ r }: { r: TrackerRow }) {
  if (r.mentor) {
    return (
      <p className="text-xs" data-mentor={r.mentor}>
        Mentor: <span className="font-medium">{r.mentor}</span>
      </p>
    );
  }
  if (r.handedOverAt && beforeTheDesk(r.statusCode)) {
    return <p className="text-xs text-muted" data-mentor="">With the documentation desk, no mentor yet</p>;
  }
  if (r.handedOverAt) return <p className="text-xs text-muted" data-mentor="">No mentor named</p>;
  return null;
}

/**
 * What the written process says should have been paid by the step the file is
 * at, beside what has actually come in. A guide, read from the same constant as
 * the student's tab; it moves nothing and blocks nothing.
 */
function MilestoneLine({ r }: { r: TrackerRow }) {
  const due = milestoneDueAt(r.statusCode);
  const inr = r.charge.byCurrency.find((b) => b.currency === "INR") ?? r.charge.byCurrency[0];
  const paid = inr ? percentPaid(inr.owed, inr.received) : null;
  if (!due && paid == null) return null;
  const short = due && paid != null && paid < (due.percent ?? 0);
  return (
    <p className={cn("mt-1 text-2xs", short ? "font-medium text-warn-700" : "text-muted")} data-milestone={due?.percent ?? ""}>
      {paid != null && `${paid}% paid`}
      {paid != null && due && ", "}
      {due && `guide: ${due.percent}% by step ${due.step}`}
    </p>
  );
}
