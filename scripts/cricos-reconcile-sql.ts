/**
 * Writes SQL that links hand-researched Australian programs to their CRICOS
 * course codes, taken from the catalogue CSVs, and removes the draft twin an
 * earlier sync added for each one.
 *   npx tsx scripts/cricos-reconcile-sql.ts > reconcile.sql
 * A twin is only removed while it is an untouched draft from the register:
 * no application, shortlist or commission rule points at it. Running the
 * output twice changes nothing the second time.
 */
import { readFileSync, readdirSync } from "node:fs";
import Papa from "papaparse";

const dir = new URL("../catalogue/", import.meta.url).pathname;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const pairs: string[] = [];
const seen = new Set<string>();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
  const { data } = Papa.parse<Record<string, string>>(readFileSync(dir + file, "utf8").trim(), { header: true, skipEmptyLines: true });
  for (const r of data) {
    if ((r.country_code ?? "").trim() !== "AU") continue;
    const code = `${r.study_area ?? ""} ${r.work_rights_note ?? ""}`.match(/\b\d{6}[A-Z]\b/)?.[0];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    pairs.push(`  (${q(r.university.trim())}, ${q(r.program.trim())}, ${q(code)})`);
  }
}

// No temporary tables and no explicit transaction: the Supabase SQL editor can
// run each statement on its own connection, where a temp table from an earlier
// statement does not exist. Each statement carries its own list instead.
const hand = `hand as (
  select h.id, cp.code
  from (values
${pairs.join(",\n")}
  ) as cp(university, program, code)
  join universities u on u.name = cp.university
  join countries c on c.id = u.country_id and c.code = 'AU'
  join programs h on h.university_id = u.id and h.name = cp.program
  where h.external_code is null and h.source is distinct from 'CRICOS'
)`;

console.log(`-- Links ${pairs.length} hand-researched Australian programs to their CRICOS codes.
-- Three statements; run the whole file. Safe to run more than once.
-- Then press "Sync from CRICOS" again.

-- 1. Remove the draft twin the register added, while nothing points at it yet.
with ${hand}
delete from programs t
using hand
where t.external_code = hand.code
  and t.source = 'CRICOS'
  and t.status = 'DRAFT'
  and not exists (select 1 from applications a where a.program_id = t.id)
  and not exists (select 1 from shortlists s where s.program_id = t.id)
  and not exists (select 1 from commission_rules r where r.program_id = t.id);

-- 2. Give each hand-researched program its code, where no other row holds it.
with ${hand}
update programs h
set external_code = hand.code, updated_at = now()
from hand
where h.id = hand.id
  and not exists (select 1 from programs x where x.external_code = hand.code);

-- 3. How it went: linked should be ${pairs.length} or close, still_unlinked 0 or close.
select count(*) filter (where p.external_code is not null) as linked,
       count(*) filter (where p.external_code is null) as still_unlinked
from (values
${pairs.join(",\n")}
) as cp(university, program, code)
join universities u on u.name = cp.university
join countries c on c.id = u.country_id and c.code = 'AU'
join programs p on p.university_id = u.id and p.name = cp.program and p.source is distinct from 'CRICOS';`);
