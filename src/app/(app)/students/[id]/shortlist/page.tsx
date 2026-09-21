import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { durationText, feeText, intakesText, LEVEL_LABEL, SHORTLIST_LIMIT } from "@/lib/catalogue";
import { checkEligibility } from "@/lib/eligibility";
import { fmtDate } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { ShortlistButton } from "@/components/shortlist-button";
import { Card, Chip, EmptyState, LinkButton, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconSearch } from "@/components/icons";

export const metadata = { title: "Shortlist" };

const CAN_EDIT: readonly string[] = ["PARTNER", "COUNSELLOR", ...ADMIN_ROLES];

export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { id } = await params;
  const student = await getStudentForUser(user, id);
  const canEdit = CAN_EDIT.includes(user.role);

  const [tests, items] = await Promise.all([
    db.query.testScores.findMany({ where: eq(schema.testScores.studentId, student.id) }),
    db.query.shortlists.findMany({
      where: eq(schema.shortlists.studentId, student.id),
      orderBy: asc(schema.shortlists.createdAt),
      with: { addedBy: true, program: { with: { university: { with: { country: true } } } } },
    }),
  ]);

  const searchHref = `/search?student=${student.id}`;
  if (!items.length) {
    return (
      <Card>
        <EmptyState icon={<IconSearch />} title="Nothing shortlisted yet">
          Search programs with this student selected and press Shortlist on the ones worth weighing up. They will line up here side by side.
          <div className="mt-4"><LinkButton href={searchHref}>Search programs for this student</LinkButton></div>
        </EmptyState>
      </Card>
    );
  }

  const cols = items.map((it) => {
    const p = it.program;
    const cur = p.university.country.currency;
    const fit = checkEligibility({ backlogs: student.backlogs, gapYears: student.gapYears, tests }, p);
    return { it, p, cur, fit };
  });

  // Cheapest verified tuition is worth pointing at; unverified figures never win.
  const tuitions = cols.map((c) => c.p.tuitionPerYear).filter((t): t is number => t != null);
  const sameCurrency = new Set(cols.map((c) => c.cur)).size === 1;
  const cheapest = sameCurrency && tuitions.length > 1 ? Math.min(...tuitions) : null;

  const rows: { label: string; cell: (c: (typeof cols)[number]) => ReactNode }[] = [
    { label: "Fit", cell: ({ fit }) => (
      <div>
        {fit.verdict === "eligible" && <Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip>}
        {fit.verdict === "on-track" && <Chip tone="warn"><IconClock className="size-3.5" /> On track</Chip>}
        {fit.verdict === "blocked" && <Chip tone="bad"><IconAlert className="size-3.5" /> Not yet</Chip>}
        {fit.verdict === "unknown" && <Chip>No rules recorded</Chip>}
        {[...fit.missing, ...fit.onTrack].length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted">{[...fit.missing, ...fit.onTrack].map((m) => <li key={m}>{m}</li>)}</ul>
        )}
      </div>
    ) },
    { label: "Level", cell: ({ p }) => `${LEVEL_LABEL[p.level] ?? p.level}${p.studyArea ? ` · ${p.studyArea}` : ""}` },
    { label: "Campus", cell: ({ p }) => `${p.campus ?? p.university.city ? `${p.campus ?? p.university.city}, ` : ""}${p.university.country.name}` },
    { label: "Duration", cell: ({ p }) => <Muted on={p.durationMonths == null}>{durationText(p.durationMonths)}</Muted> },
    { label: "Intakes", cell: ({ p }) => <Muted on={!p.intakeMonths.length}>{intakesText(p.intakeMonths)}</Muted> },
    { label: "Tuition per year", cell: ({ p, cur }) => (
      <span className="tabular">
        <Muted on={p.tuitionPerYear == null}>{feeText(p.tuitionPerYear, cur, { zero: "No tuition fee" })}</Muted>
        {cheapest != null && p.tuitionPerYear === cheapest && <Chip tone="ok" className="ml-1.5">Lowest</Chip>}
      </span>
    ) },
    { label: "Application fee", cell: ({ p, cur }) => <Muted on={p.applicationFee == null}>{feeText(p.applicationFee, cur, { zero: "No application fee" })}</Muted> },
    { label: "Deposit", cell: ({ p, cur }) => <Muted on={p.initialDeposit == null}>{feeText(p.initialDeposit, cur, { zero: "No deposit" })}</Muted> },
    { label: "English", cell: ({ p }) => {
      const parts = [p.minIelts != null && `IELTS ${p.minIelts}`, p.minPte != null && `PTE ${p.minPte}`, p.minOetGrade && `OET ${p.minOetGrade}`].filter(Boolean);
      return parts.length ? parts.join(" · ") + (p.moiAccepted ? " · MOI accepted" : "") : <Muted on>{p.moiAccepted ? "MOI accepted" : "Not recorded"}</Muted>;
    } },
    { label: "German", cell: ({ p }) => <Muted on={!p.minGermanLevel}>{p.minGermanLevel ?? "Not required"}</Muted> },
    { label: "Backlogs / gap", cell: ({ p }) => (
      <Muted on={p.maxBacklogs == null && p.maxGapYears == null}>
        {p.maxBacklogs == null && p.maxGapYears == null ? "No rule recorded" : [p.maxBacklogs != null && `≤ ${p.maxBacklogs} backlogs`, p.maxGapYears != null && `≤ ${p.maxGapYears} yr gap`].filter(Boolean).join(" · ")}
      </Muted>
    ) },
    { label: "Post-study work", cell: ({ p }) => (
      <div>
        {p.workRights === "ELIGIBLE" && <Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip>}
        {p.workRights === "INELIGIBLE" && <Chip tone="bad"><IconAlert className="size-3.5" /> Not eligible</Chip>}
        {p.workRights === "UNKNOWN" && <Muted on>Not confirmed</Muted>}
        {p.workRightsNote && <p className="mt-1 text-xs text-muted">{p.workRightsNote}</p>}
      </div>
    ) },
    { label: "Added", cell: ({ it }) => <span className="text-xs text-muted">{fmtDate(it.createdAt)}{it.addedBy ? ` by ${it.addedBy.name}` : ""}</span> },
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold">Shortlist</h2>
          <p className="text-[13px] text-muted">
            {items.length} of {SHORTLIST_LIMIT} · blank figures have not been verified with the institution
          </p>
        </div>
        {canEdit && items.length < SHORTLIST_LIMIT && <LinkButton size="sm" variant="secondary" href={searchHref}>Add from search</LinkButton>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth: `${180 + cols.length * 240}px` }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-[180px] bg-surface" />
              {cols.map(({ p }) => (
                <th key={p.id} scope="col" className="w-[240px] border-l border-line px-4 py-3 text-left align-top font-normal">
                  <Link prefetch={false} href={`/programs/${p.id}?student=${student.id}`} className="font-semibold text-ink hover:text-brand-700 hover:underline">{p.name}</Link>
                  <Link prefetch={false} href={`/universities/${p.university.id}`} className="mt-0.5 block text-xs text-muted hover:underline">{p.university.name}</Link>
                  {p.status !== "LIVE" && <Chip tone="warn" className="mt-1">No longer open</Chip>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left align-top text-[11px] font-semibold uppercase tracking-wider text-muted">{r.label}</th>
                {cols.map((c) => (
                  <td key={c.p.id} className="border-l border-line px-4 py-2.5 align-top">{r.cell(c)}</td>
                ))}
              </tr>
            ))}
            {canEdit && (
              <tr className="border-t border-line">
                <th className="sticky left-0 z-10 bg-surface" />
                {cols.map(({ p }) => (
                  <td key={p.id} className="border-l border-line px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-2">
                      {p.status === "LIVE" && p.intakeMonths.length > 0 && (
                        <LinkButton size="sm" href={`/students/${student.id}/applications?tab=apply&program=${p.id}`}>Apply</LinkButton>
                      )}
                      <ShortlistButton studentId={student.id} programId={p.id} on reload labels={{ on: "Remove", off: "Add back" }} />
                    </div>
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Muted({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cn(on && "text-muted")}>{children}</span>;
}
