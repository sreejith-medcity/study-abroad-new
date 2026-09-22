import { eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";

/** Every live commission rule; the table is small, so lists pick from it in memory. */
export function activeRules() {
  return db.select().from(schema.commissionRules).where(eq(schema.commissionRules.active, true));
}

/**
 * The best live rule per program, per university and per country, as three
 * subqueries to left join, and the partner's expected share in rupees as SQL
 * over them, for sorting search. Same choice as pickRule: program beats
 * university beats country, and a rule pinned to a coming year beats an open
 * one. A percentage without a verified yearly tuition, or a currency with no
 * rate, gives null and sorts last. Joining is what keeps this fast at 27,000
 * programs; a subquery per row took seconds.
 */
export function partnerShareJoins(rates: Record<string, number>) {
  const cr = schema.commissionRules;
  const open = sql`${cr.active} and (${cr.intakeYear} is null or ${cr.intakeYear} >= extract(year from current_date))`;
  const cols = { id: cr.id, basis: cr.basis, pct: cr.percentOfTuition, flat: cr.flatAmount, currency: cr.currency, share: cr.partnerSharePercent };
  const pinnedFirst = sql`${cr.intakeYear} is null`;
  const rp = db.selectDistinctOn([cr.programId], { ...cols, key: cr.programId }).from(cr).where(sql`${open} and ${cr.programId} is not null`).orderBy(cr.programId, pinnedFirst).as("rp");
  const ru = db.selectDistinctOn([cr.universityId], { ...cols, key: cr.universityId }).from(cr).where(sql`${open} and ${cr.universityId} is not null`).orderBy(cr.universityId, pinnedFirst).as("ru");
  const rc = db.selectDistinctOn([cr.countryId], { ...cols, key: cr.countryId }).from(cr).where(sql`${open} and ${cr.countryId} is not null`).orderBy(cr.countryId, pinnedFirst).as("rc");

  const known = Object.entries(rates).filter(([k]) => /^[A-Z]{3}$/.test(k));
  const rate = (col: SQL) => sql`(case ${col} ${sql.join(known.map(([k, v]) => sql`when ${k} then ${v}::numeric`), sql` `)} end)`;
  const share = (a: typeof rp | typeof ru | typeof rc) =>
    sql`(case when ${a.basis} = 'FLAT' then ${a.flat} * ${rate(sql`${a.currency}`)}
      else ${schema.programs.tuitionPerYear} * ${a.pct} / 100 * ${rate(sql`${schema.countries.currency}`)} end * ${a.share} / 100)`;
  const expr = sql`(case when ${rp.id} is not null then ${share(rp)} when ${ru.id} is not null then ${share(ru)} else ${share(rc)} end)`;
  return { rp, ru, rc, expr };
}

/** SQL for search: a live commission rule covers this program. */
export const hasCommissionRule = sql`exists (
  select 1 from commission_rules r
  where r.active
    and (r.program_id = programs.id or r.university_id = programs.university_id or r.country_id = universities.country_id)
    and (r.intake_year is null or r.intake_year >= extract(year from current_date))
)`;
