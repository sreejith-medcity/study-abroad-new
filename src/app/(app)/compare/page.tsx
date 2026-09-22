import Link from "next/link";
import { commissionVisible } from "@/server/commission-visibility";
import { and, eq, inArray } from "drizzle-orm";
import type { ReactNode } from "react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL, durationText, feeText, inrApprox, intakesText, tuitionText } from "@/lib/catalogue";
import { fmtDate, fmtMoney } from "@/lib/format";
import { partnerEstimate, pickRule } from "@/lib/money";
import { APP_ROLES } from "@/lib/permissions";
import { PROGRAM_TAGS } from "@/lib/program-tags";
import { rankLabels } from "@/lib/rankings";
import { activeRules } from "@/server/commission-estimate";
import { fxRates, getSettings } from "@/server/settings";
import { Card, Chip, EmptyState, LinkButton, PageHeader, cn } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { IconAlert, IconCheck, IconSearch } from "@/components/icons";

export const metadata = { title: "Compare programs" };

const MAX = 6;

/** Programs ticked in search, side by side, printable for a student without the commission row. */
export default async function ComparePage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const ids = [...new Set((Array.isArray(sp.id) ? sp.id : sp.id ? [sp.id] : []).filter((x) => /^[A-Za-z0-9_-]{8,40}$/.test(x)))];
  const tooMany = ids.length > MAX;
  const found = ids.length
    ? await db.query.programs.findMany({
        where: and(inArray(schema.programs.id, ids.slice(0, MAX)), eq(schema.programs.status, "LIVE")),
        with: { university: { with: { country: true } } },
      })
    : [];
  // Keep the order they were ticked in.
  const programs = ids.map((id) => found.find((p) => p.id === id)).filter((p): p is (typeof found)[number] => !!p);

  if (!programs.length) {
    return (
      <>
        <PageHeader title="Compare programs" />
        <Card>
          <EmptyState icon={<IconSearch />} title="Nothing ticked to compare">
            Tick up to {MAX} programs in search and press Compare.
            <div className="mt-4"><LinkButton href="/search">Search programs</LinkButton></div>
          </EmptyState>
        </Card>
      </>
    );
  }

  const rates = fxRates(await getSettings());
  const showCommission = await commissionVisible(user);
  const rules = showCommission ? await activeRules() : [];
  const cols = programs.map((p) => {
    const cur = p.university.country.currency;
    const rule = pickRule(rules, p.id, p.university.id, p.university.country.id);
    return { p, cur, commission: rule ? partnerEstimate(rule, p.tuitionPerYear, cur) : null };
  });
  const tuitions = cols.map((c) => c.p.tuitionPerYear).filter((t): t is number => t != null);
  const sameCurrency = new Set(cols.map((c) => c.cur)).size === 1;
  const cheapest = sameCurrency && tuitions.length > 1 ? Math.min(...tuitions) : null;

  const allRows: { label: string; cell: (c: (typeof cols)[number]) => ReactNode; hidePrint?: boolean; hide?: boolean }[] = [
    { label: "Level", cell: ({ p }) => `${LEVEL_LABEL[p.level] ?? p.level}${p.studyArea ? ` · ${p.studyArea}` : ""}` },
    { label: "Campus", cell: ({ p }) => `${p.campus ?? p.university.city ? `${p.campus ?? p.university.city}, ` : ""}${p.university.country.name}` },
    { label: "Ranking", cell: ({ p }) => <Muted on={!rankLabels(p.university).length}>{rankLabels(p.university).join(" · ") || "Not recorded"}</Muted> },
    { label: "Duration", cell: ({ p }) => <Muted on={p.durationMonths == null}>{durationText(p.durationMonths)}</Muted> },
    { label: "Intakes", cell: ({ p }) => <Muted on={!p.intakeMonths.length}>{intakesText(p.intakeMonths)}</Muted> },
    { label: "Tuition", cell: ({ p, cur }) => (
      <span className="tabular">
        <Muted on={p.tuitionPerYear == null && p.tuitionTotal == null}>{tuitionText(p.tuitionPerYear, p.tuitionTotal, cur)}</Muted>
        {inrApprox(p.tuitionPerYear ?? p.tuitionTotal, cur, rates) && <span className="block text-xs text-muted">{inrApprox(p.tuitionPerYear ?? p.tuitionTotal, cur, rates)}</span>}
        {cheapest != null && p.tuitionPerYear === cheapest && <Chip tone="ok" className="ml-1.5">Lowest</Chip>}
      </span>
    ) },
    { label: "Application fee", cell: ({ p, cur }) => (
      <>
        <Muted on={p.applicationFee == null}>{feeText(p.applicationFee, cur, { zero: "No application fee" })}</Muted>
        {p.feeWaiver && <span className="block text-xs text-emerald-700">Waiver: {p.feeWaiver}</span>}
      </>
    ) },
    { label: "Your commission", cell: ({ commission }) => commission ? (commission.amount != null ? <span className="font-medium text-emerald-700">≈ {fmtMoney(commission.amount, commission.currency)}</span> : <Muted on>{commission.terms}</Muted>) : <Muted on>No rule</Muted>, hidePrint: true, hide: !showCommission },
    { label: "Deposit", cell: ({ p, cur }) => (
      <>
        <Muted on={p.initialDeposit == null}>{feeText(p.initialDeposit, cur, { zero: "No deposit" })}</Muted>
        {p.balanceDeposit != null && <span className="block text-xs text-muted">Balance {fmtMoney(p.balanceDeposit, cur)}</span>}
      </>
    ) },
    { label: "Typical scholarship", cell: ({ p }) => <Muted on={!p.typicalScholarship}>{p.typicalScholarship ?? "Not recorded"}</Muted> },
    { label: "English", cell: ({ p }) => {
      const parts = [p.minIelts != null && `IELTS ${p.minIelts}${p.minIeltsBand != null ? ` (no band below ${p.minIeltsBand})` : ""}`, p.minPte != null && `PTE ${p.minPte}`, p.minToefl != null && `TOEFL ${p.minToefl}`, p.minDuolingo != null && `Duolingo ${p.minDuolingo}`, p.minOetGrade && `OET ${p.minOetGrade}`].filter(Boolean);
      return parts.length ? parts.join(" · ") + (p.moiAccepted ? " · MOI accepted" : "") : <Muted on>{p.moiAccepted ? "MOI accepted" : "Not recorded"}</Muted>;
    } },
    { label: "Marks and admission tests", cell: ({ p }) => {
      const parts = [p.minAcademicPercent != null && `${p.minAcademicPercent}% in the qualifying study`, p.minGre != null && `GRE ${p.minGre}`, p.minGmat != null && `GMAT ${p.minGmat}`, p.minSat != null && `SAT ${p.minSat}`].filter(Boolean);
      return parts.length ? parts.join(" · ") : <Muted on>Not recorded</Muted>;
    } },
    { label: "Other entry requirements", cell: ({ p }) => <Muted on={!p.entryRequirements}><span className="whitespace-pre-line">{p.entryRequirements ?? "Not recorded"}</span></Muted> },
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
      </div>
    ) },
    { label: "Labels", cell: ({ p }) => p.tags.length ? <div className="flex flex-wrap gap-1">{p.tags.map((t) => <Chip key={t} tone="info">{PROGRAM_TAGS[t as keyof typeof PROGRAM_TAGS] ?? t}</Chip>)}</div> : <Muted on>None</Muted> },
    { label: "Program page", cell: ({ p }) => p.programUrl ? <a href={p.programUrl} target="_blank" rel="noreferrer" className="break-all text-brand-600 hover:underline">{new URL(p.programUrl).hostname}</a> : <Muted on>Not recorded</Muted> },
  ];

  const rows = allRows.filter((r) => !r.hide);

  return (
    <>
      <PageHeader title="Compare programs" subtitle="Blank figures have not been verified with the institution." />
      {tooMany && <p className="mb-3 text-[13px] text-amber-700">Only the first {MAX} ticked programs are shown.</p>}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-[15px] font-semibold">
            {programs.length} program{programs.length === 1 ? "" : "s"}<span data-print="only" className="font-normal">, prepared {fmtDate(new Date())}</span>
          </h2>
          <div className="flex flex-wrap gap-2" data-print="hide">
            <PrintButton />
            <LinkButton size="sm" variant="secondary" href={`/api/programs/search-export?${programs.map((p) => `id=${p.id}`).join("&")}`}>Download CSV</LinkButton>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" style={{ minWidth: `${180 + cols.length * 240}px` }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-[180px] bg-surface" />
                {cols.map(({ p }) => (
                  <th key={p.id} scope="col" className="w-[240px] border-l border-line px-4 py-3 text-left align-top font-normal">
                    <Link prefetch={false} href={`/programs/${p.id}`} className="font-semibold text-ink hover:text-brand-700 hover:underline">{p.name}</Link>
                    <Link prefetch={false} href={`/universities/${p.university.id}`} className="mt-0.5 block text-xs text-muted hover:underline">{p.university.name}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-line" data-print={r.hidePrint ? "hide" : undefined}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2.5 text-left align-top text-[11px] font-semibold uppercase tracking-wider text-muted">{r.label}</th>
                  {cols.map((c) => (
                    <td key={c.p.id} className="border-l border-line px-4 py-2.5 align-top">{r.cell(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Muted({ on, children }: { on: boolean; children: ReactNode }) {
  return <span className={cn(on && "text-muted")}>{children}</span>;
}
