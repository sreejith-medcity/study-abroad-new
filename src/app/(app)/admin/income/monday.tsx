import Link from "next/link";
import { INCOME_LABEL } from "@/lib/income";
import { daysToPayText, financialYears, fastestPayer, inWords, shareText, type FinancialYear, type ShapedRow } from "@/lib/money-report";
import { currenciesInPlay, moneyReport } from "@/server/money-report";
import { Alert, Card, CardHeader, Table, Td, Th, cn } from "@/components/ui";
import type { IncomeKind } from "@/db/schema";

/**
 * What management reads on a Monday.
 *
 * Four tables, one question each: which road the money came down, what it was
 * for, which branch sent the student, and which country pays. A branch owner
 * sees only their own branch; the desk sees all eighteen.
 *
 * The column that changes behaviour is the last one. A route that pays in fifty
 * days is worth more than one that pays in ninety-six at the same rate, and that
 * is a fact about the vendor's behaviour rather than about its terms, so it is
 * measured from the invoices rather than read off the contract.
 */

function MoneyTable({
  title,
  subtitle,
  what,
  rows,
  total,
  withDays,
  withShare,
  label,
}: {
  title: string;
  subtitle: string;
  what: string;
  rows: ShapedRow[];
  total: { students: number; expected: number | null; received: number | null };
  withDays?: boolean;
  withShare?: boolean;
  label?: (row: ShapedRow) => string;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <p className="p-4 text-[13px] text-muted">Nothing recorded in this year yet.</p>
      ) : (
        <Table tableClassName="min-w-[640px]">
          <thead>
            <tr>
              <Th>{what}</Th>
              <Th className="text-right">Students</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Received</Th>
              {withShare ? <Th className="text-right">Share</Th> : <Th className="text-right">Per student</Th>}
              {withDays && <Th className="text-right">Days to pay</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="font-medium">{label ? label(r) : r.label}</Td>
                <Td className="text-right tabular-nums">{r.students}</Td>
                <Td className="text-right tabular-nums text-muted">{inWords(r.expected)}</Td>
                <Td className="text-right tabular-nums">{inWords(r.received)}</Td>
                {withShare ? (
                  <Td className="text-right tabular-nums text-muted">{shareText(r.share)}</Td>
                ) : (
                  <Td className="text-right tabular-nums text-muted">{inWords(r.perStudent)}</Td>
                )}
                {withDays && <Td className="text-right tabular-nums text-muted">{daysToPayText(r.daysToPay)}</Td>}
              </tr>
            ))}
            <tr className="border-t-2 border-line-strong font-medium">
              <Td>All of it</Td>
              <Td className="text-right tabular-nums">{total.students}</Td>
              <Td className="text-right tabular-nums">{inWords(total.expected)}</Td>
              <Td className="text-right tabular-nums">{inWords(total.received)}</Td>
              <Td />
              {withDays && <Td />}
            </tr>
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export async function MondayRead({
  year,
  currency,
  orgId,
  today,
  oneBranch,
}: {
  year: FinancialYear;
  currency?: string;
  orgId?: string;
  today: Date;
  oneBranch: boolean;
}) {
  // One currency at a time. Commission is recorded in the vendor's own, so a
  // page that showed only rupees was leaving the largest figures off it.
  const currencies = await currenciesInPlay(year, orgId);
  const showing = currency && currencies.includes(currency) ? currency : currencies[0];
  const report = await moneyReport(year, showing, orgId);
  const note = fastestPayer(report.route.rows);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">Financial year</span>
        {financialYears(today).map((fy) => (
          <Link
            key={fy.key}
            href={`/admin/income?tab=monday&fy=${fy.key}&cur=${showing}`}
            className={cn(
              "rounded-md px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset",
              fy.key === year.key ? "bg-brand-50 text-brand-700 ring-brand-200" : "text-muted ring-line hover:text-ink",
            )}
          >
            {fy.label}
          </Link>
        ))}
      </div>

      {currencies.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">Currency</span>
          {currencies.map((c) => (
            <Link
              key={c}
              href={`/admin/income?tab=monday&fy=${year.key}&cur=${c}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] font-medium ring-1 ring-inset",
                c === showing ? "bg-brand-50 text-brand-700 ring-brand-200" : "text-muted ring-line hover:text-ink",
              )}
            >
              {c}
            </Link>
          ))}
          <span className="text-[13px] text-muted">Nothing is converted, so every figure matches the bank it came from.</span>
        </div>
      )}

      {note && (
        <Alert tone="info" title="Worth noticing">
          {note}
        </Alert>
      )}

      <div className="mt-4 grid gap-4">
        <MoneyTable
          title="Where the money came down"
          subtitle="One row per vendor. A line with no vendor on it is money Medcity earned directly, or money nobody has attributed yet."
          what="Route"
          rows={report.route.rows}
          total={report.route.total}
          withDays
        />
        <MoneyTable
          title="What the money was for"
          subtitle="University commission is most of it in a normal year. The rest is what a branch sells around the application, and is the part that moves when somebody is asked to sell it."
          what="Line"
          rows={report.line.rows}
          total={report.line.total}
          withShare
          label={(r) => INCOME_LABEL[r.key as IncomeKind] ?? r.label}
        />
        {!oneBranch && (
          <MoneyTable
            title="Which branch sent the student"
            subtitle="Students with money on them this year, not students enrolled. A branch with students and little received has either sold nothing around the application or has not been paid."
            what="Branch"
            rows={report.branch.rows}
            total={report.branch.total}
          />
        )}
        <MoneyTable
          title="Where the money actually comes from"
          subtitle="Rarely where the enquiries come from. Commission per student by country, and how long that country's vendors take to pay."
          what="Destination"
          rows={report.destination.rows}
          total={report.destination.total}
          withDays
        />
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        A line belongs to the year its money arrived, or, where it has not arrived, the year it was due. Written-off lines are counted
        nowhere{report.setAside.writtenOff > 0 ? `, and ${report.setAside.writtenOff} of them fell in this year` : ""}.
        {report.setAside.otherCurrency > 0
          ? ` ${report.setAside.otherCurrency} line${report.setAside.otherCurrency === 1 ? " is" : "s are"} in another currency; they are on this page under ${currencies.filter((c) => c !== showing).join(", ")} rather than added to these totals, because adding them would need a rate nobody recorded.`
          : ""}
      </p>
    </>
  );
}
