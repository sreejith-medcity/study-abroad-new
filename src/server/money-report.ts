import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { shape, type FinancialYear, type MoneyRow } from "@/lib/money-report";

/**
 * Counting what came in, four ways.
 *
 * Every table answers the same question from a different side, so they share one
 * window and one rule about what counts: a line belongs to the year its money
 * arrived, or, where it has not arrived, the year it was due. A line nobody has
 * dated at all falls back to the day it was written, which is the only date it
 * has.
 *
 * Written-off lines are left out everywhere. A line in a currency other than
 * rupees is left out of the totals and counted separately, because adding
 * dollars to rupees needs a rate nobody recorded and a made-up total is worse
 * than a stated gap.
 */

const window = (fy: FinancialYear): SQL =>
  sql`coalesce(l.received_on, l.due_on, (l.created_at at time zone 'UTC')::date) between ${fy.from}::date and ${fy.to}::date`;

/**
 * One currency at a time, never converted.
 *
 * University commission is recorded in the vendor's own currency, so filtering
 * to rupees left the biggest figures in the business off the page. Adding them
 * needs a rate nobody recorded, and a made-up total is worse than one table per
 * currency: every figure here matches the bank it came from.
 */
const counted = (currency: string) => sql`l.state <> 'WRITTEN_OFF' and l.currency = ${currency}`;

const mine = (orgId?: string): SQL => (orgId ? sql`and l.org_id = ${orgId}` : sql``);

/** Every currency with a line in this window, rupees first, for the picker. */
export async function currenciesInPlay(fy: FinancialYear, orgId?: string): Promise<string[]> {
  const rows = await db.execute<{ currency: string }>(sql`
    select distinct l.currency
    from income_lines l
    where l.state <> 'WRITTEN_OFF' and ${window(fy)} ${mine(orgId)}
  `);
  const found = rows.map((r) => r.currency).filter(Boolean);
  const rest = found.filter((c) => c !== "INR").sort();
  return found.includes("INR") || found.length === 0 ? ["INR", ...rest] : rest;
}

type Raw = { key: string | null; label: string | null; students: number; expected: number | null; received: number | null; days_to_pay: number | null };

const rows = (raw: Raw[], fallback: string): MoneyRow[] =>
  raw.map((r) => ({
    key: r.key ?? fallback,
    label: r.label ?? fallback,
    students: Number(r.students),
    // Left null rather than counted as nought: not one line behind this row
    // carried a figure, and nought is a number somebody would act on.
    expected: r.expected == null ? null : Number(r.expected),
    received: r.received == null ? null : Number(r.received),
    daysToPay: r.days_to_pay == null ? null : Math.round(Number(r.days_to_pay)),
  }));

/**
 * The middle number of days between an invoice going out and the money landing.
 *
 * Measured, not read off the vendor's stated terms: what a vendor says it pays
 * in and what it pays in are two different figures, and only one of them is
 * worth putting in front of somebody choosing a road.
 */
const DAYS_TO_PAY = sql`
  percentile_cont(0.5) within group (
    order by extract(epoch from (i.paid_at - coalesce(i.sent_at, i.raised_on::timestamptz))) / 86400
  ) filter (where i.paid_at is not null and coalesce(i.sent_at, i.raised_on::timestamptz) is not null)`;

/** By the road the student was sent down: the vendor on the line. */
async function byRoute(fy: FinancialYear, currency: string, orgId?: string) {
  const raw = await db.execute<Raw>(sql`
    select v.id as key, v.name as label,
      count(distinct l.student_id)::int as students,
      sum(l.expected_amount)::int as expected,
      sum(l.received_amount)::int as received,
      ${DAYS_TO_PAY} as days_to_pay
    from income_lines l
    left join vendors v on v.id = l.vendor_id
    left join vendor_invoices i on i.id = l.invoice_id
    where ${counted(currency)} and ${window(fy)} ${mine(orgId)}
    group by 1, 2
  `);
  return rows(raw, "No vendor on the line");
}

/** By what the money was for. */
async function byLine(fy: FinancialYear, currency: string, orgId?: string) {
  const raw = await db.execute<Raw>(sql`
    select l.kind::text as key, l.kind::text as label,
      count(distinct l.student_id)::int as students,
      sum(l.expected_amount)::int as expected,
      sum(l.received_amount)::int as received,
      null::numeric as days_to_pay
    from income_lines l
    where ${counted(currency)} and ${window(fy)} ${mine(orgId)}
    group by 1, 2
  `);
  return rows(raw, "Not recorded");
}

/** By the branch that sent the student. */
async function byBranch(fy: FinancialYear, currency: string, orgId?: string) {
  const raw = await db.execute<Raw>(sql`
    select o.id as key, o.name as label,
      count(distinct l.student_id)::int as students,
      sum(l.expected_amount)::int as expected,
      sum(l.received_amount)::int as received,
      null::numeric as days_to_pay
    from income_lines l
    join organizations o on o.id = l.org_id
    where ${counted(currency)} and ${window(fy)} ${mine(orgId)}
    group by 1, 2
  `);
  return rows(raw, "Not recorded");
}

/**
 * By where the money actually comes from, which is rarely where the enquiries
 * come from. A line with no application behind it has no country, and says so.
 */
async function byDestination(fy: FinancialYear, currency: string, orgId?: string) {
  const raw = await db.execute<Raw>(sql`
    select c.id as key, c.name as label,
      count(distinct l.student_id)::int as students,
      sum(l.expected_amount)::int as expected,
      sum(l.received_amount)::int as received,
      ${DAYS_TO_PAY} as days_to_pay
    from income_lines l
    left join applications a on a.id = l.application_id
    left join programs p on p.id = a.program_id
    left join universities u on u.id = p.university_id
    left join countries c on c.id = u.country_id
    left join vendor_invoices i on i.id = l.invoice_id
    where ${counted(currency)} and ${window(fy)} ${mine(orgId)}
    group by 1, 2
  `);
  return rows(raw, "Not tied to an application");
}

export type MoneyReport = {
  year: FinancialYear;
  currency: string;
  route: ReturnType<typeof shape>;
  line: ReturnType<typeof shape>;
  branch: ReturnType<typeof shape>;
  destination: ReturnType<typeof shape>;
  /** Lines the tables above leave out, so the gap is stated rather than hidden. */
  setAside: { otherCurrency: number; writtenOff: number };
};

export async function moneyReport(fy: FinancialYear, currency: string, orgId?: string): Promise<MoneyReport> {
  const [route, line, branch, destination, aside] = await Promise.all([
    byRoute(fy, currency, orgId),
    byLine(fy, currency, orgId),
    byBranch(fy, currency, orgId),
    byDestination(fy, currency, orgId),
    db.execute<{ other_currency: number; written_off: number; students: number }>(sql`
      select
        count(*) filter (where l.currency <> ${currency} and l.state <> 'WRITTEN_OFF')::int as other_currency,
        count(*) filter (where l.state = 'WRITTEN_OFF')::int as written_off,
        count(distinct l.student_id) filter (where ${counted(currency)})::int as students
      from income_lines l
      where ${window(fy)} ${mine(orgId)}
    `),
  ]);

  /**
   * One student with money in three countries is three rows and one student, so
   * the figure under every table is the same count of people, not the sum of the
   * rows above it. Adding the rows gives a number larger than the branch has
   * students, which somebody would then repeat in a meeting.
   */
  const students = Number(aside[0]?.students ?? 0);
  const people = (shaped: ReturnType<typeof shape>) => ({ ...shaped, total: { ...shaped.total, students } });

  return {
    year: fy,
    currency,
    route: people(shape(route)),
    line: people(shape(line)),
    branch: people(shape(branch)),
    destination: people(shape(destination)),
    setAside: { otherCurrency: Number(aside[0]?.other_currency ?? 0), writtenOff: Number(aside[0]?.written_off ?? 0) },
  };
}
