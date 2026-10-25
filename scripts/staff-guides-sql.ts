/**
 * The staff guides as SQL that is safe to run twice: the learning library row
 * for each guide, the training course that quizzes on it, and the course's
 * questions.
 *
 *   npx tsx scripts/staff-guides-sql.ts > deploy/staff-guides.sql
 *
 * The guides' text lives in code (src/lib/staff-guides.ts) and is served under
 * /learning/guides, so the text itself reaches production with the deploy; the
 * rows here are what list it in the library and the training screen. Each row
 * is inserted only where its title is not there yet. The one update is the
 * library row's summary, and it fires only while the row still carries a
 * summary the seed gave it before, so a summary an admin has rewritten stays
 * as they wrote it. A course's questions are inserted only while the course
 * has none, so a quiz the team has edited is left alone.
 */
import { createId } from "../src/lib/id";
import { STAFF_GUIDES, guideHref } from "../src/lib/staff-guides";

const q = (v: string | null | undefined) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const arr = (xs: string[]) => `ARRAY[${xs.map(q).join(", ")}]::text[]`;

// The library row needs a creator: the first owner or admin account, in that
// order, so the row reads as the Overseas team's. No such account means no
// row, which the count at the end shows.
const CREATOR = "(SELECT id FROM users WHERE active AND role IN ('SUPER_ADMIN', 'OPS_MANAGER', 'ADMIN') ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'OPS_MANAGER' THEN 1 ELSE 2 END, created_at LIMIT 1)";

const out: string[] = [
  "-- The staff guides: a library row and a training course for each. Run in the",
  "-- Supabase SQL editor (or psql on the VPS) with the release that carries the",
  "-- guide pages under /learning/guides. Safe to run twice: rows are inserted only",
  "-- where the title is not there, a summary is updated only while it still reads",
  "-- as the seed first wrote it, and questions are added only to a course that",
  "-- has none.",
];

for (const g of STAFF_GUIDES) {
  out.push("", `-- ${g.title}`);
  const cols = "id, title, summary, kind, audience, url, published, pinned, created_by_id";
  const values = [q(createId()), q(g.title), q(g.summary), "'GUIDE'", arr(g.audience), q(guideHref(g.slug)), "true", "true", "u.id"].join(", ");
  out.push(`INSERT INTO resources (${cols}) SELECT ${values} FROM ${CREATOR} u WHERE NOT EXISTS (SELECT 1 FROM resources r WHERE r.title = ${q(g.title)});`);

  if (g.previousSummaries.length) {
    out.push(
      `UPDATE resources SET summary = ${q(g.summary)}, updated_at = now() WHERE title = ${q(g.title)} AND summary IN (${g.previousSummaries.map(q).join(", ")});`,
    );
  } else {
    out.push("-- The summary has not changed since it was first seeded, so there is nothing to bring up to date.");
  }

  const courseCols = "id, title, description, resource_ids, pass_mark, published, created_by_id";
  const reading = `ARRAY(SELECT r.id FROM resources r WHERE r.title = ${q(g.title)} ORDER BY r.created_at LIMIT 1)`;
  const courseValues = [q(createId()), q(g.course.title), q(g.course.description), reading, g.course.passMark, "true", "NULL"].join(", ");
  out.push(
    `INSERT INTO training_courses (${courseCols}) SELECT ${courseValues} WHERE EXISTS (SELECT 1 FROM resources r WHERE r.title = ${q(g.title)}) AND NOT EXISTS (SELECT 1 FROM training_courses c WHERE c.title = ${q(g.course.title)});`,
  );

  const rows = g.course.questions.map((x, i) => `(${q(createId())}, ${q(x.prompt)}, ${arr(x.options)}, ${x.correctIndex}, ${(i + 1) * 10})`);
  out.push(
    "INSERT INTO training_questions (id, course_id, prompt, options, correct_index, sort_order)",
    "SELECT v.id, c.id, v.prompt, v.options, v.correct_index, v.sort_order",
    "FROM training_courses c",
    `JOIN (VALUES ${rows.join(", ")}) AS v(id, prompt, options, correct_index, sort_order) ON true`,
    `WHERE c.title = ${q(g.course.title)} AND NOT EXISTS (SELECT 1 FROM training_questions x WHERE x.course_id = c.id);`,
  );
}

out.push(
  "",
  "-- What is there now.",
  `SELECT 'Guides in the library ' || count(*) FROM resources WHERE title IN (${STAFF_GUIDES.map((g) => q(g.title)).join(", ")})`,
  `UNION ALL SELECT 'Guide courses ' || count(*) FROM training_courses WHERE title IN (${STAFF_GUIDES.map((g) => q(g.course.title)).join(", ")})`,
  `UNION ALL SELECT 'Guide questions ' || count(*) FROM training_questions WHERE course_id IN (SELECT id FROM training_courses WHERE title IN (${STAFF_GUIDES.map((g) => q(g.course.title)).join(", ")}));`,
  "",
);
console.log(out.join("\n"));
