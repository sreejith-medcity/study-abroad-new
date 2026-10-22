import { chargeMoney } from "@/lib/ausbildung";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, istTime } from "@/lib/format";
import { STUDENT_WORK_ROLES, isStaff } from "@/lib/permissions";
import { chargingCountries, trackerChoices, trackerRows, type TrackerRow, type TrackerShow, type TrackerTab } from "@/server/ausbildung";
import { commissionVisible } from "@/server/commission-visibility";
import { FilterBar } from "@/components/filter-bar";
import { Card, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";

export const metadata = { title: "Ausbildung and service charge" };
export const dynamic = "force-dynamic";

const SHOW: { value: TrackerShow; label: string }[] = [
  { value: "interview", label: "Interview coming up" },
  { value: "contract", label: "Contract received" },
  { value: "german", label: "German not finished" },
  { value: "unpaid", label: "Service charge pending" },
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
  const tab: TrackerTab = sp.tab === "service" ? "service" : "ausbildung";
  const show = SHOW.some((s) => s.value === sp.show) ? (sp.show as TrackerShow) : undefined;
  const [rows, choices, money, charging] = await Promise.all([
    trackerRows(user, { tab, org: sp.branch, counsellor: sp.who, q: sp.q, show }),
    trackerChoices(user),
    commissionVisible(user),
    chargingCountries(),
  ]);
  const staff = isStaff(user);

  const tabHref = (t: TrackerTab) => `/ausbildung${t === "service" ? "?tab=service" : ""}`;

  return (
    <>
      <PageHeader
        title="Ausbildung and service charge"
        subtitle="Every Ausbildung student and every student bound for a service-charge country, with where each one stands."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Which students">
        {(
          [
            ["ausbildung", "Ausbildung"],
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

      <FilterBar
        primary={4}
        fields={[
          { kind: "search", name: "q", label: "Student", placeholder: "Name, Medcity ID or phone" },
          ...(choices.orgs.length > 1 ? [{ kind: "select" as const, name: "branch", label: "Branch", options: choices.orgs.map((o) => ({ value: o.id, label: o.name })) }] : []),
          ...(choices.people.length > 1 ? [{ kind: "select" as const, name: "who", label: "Counsellor", options: choices.people.map((p) => ({ value: p.id, label: p.name })) }] : []),
          {
            kind: "select" as const,
            name: "show",
            label: "Show",
            options: SHOW.filter((s) => (tab === "ausbildung" ? true : s.value === "german" || s.value === "unpaid"))
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
        <EmptyState title={tab === "ausbildung" ? "No Ausbildung students here" : "No students bound for a service-charge country"}>
          {tab === "service" && !charging.length
            ? "Tick the countries that collect a service charge under Destinations, and their students appear here."
            : "Widen the filters, or register a student."}
        </EmptyState>
      ) : (
        <Card>
          <Table tableClassName="min-w-[1080px]">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Registered</Th>
                <Th>Branch and counsellor</Th>
                {tab === "ausbildung" ? <Th>Preferences</Th> : <Th>Destination</Th>}
                <Th>German</Th>
                {tab === "ausbildung" && <Th>Application, interview, contract</Th>}
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
    </>
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
      ) : (
        <Td className="text-sm">{r.destination ?? <span className="text-muted">Not recorded</span>}</Td>
      )}
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
        </Td>
      )}
    </tr>
  );
}
