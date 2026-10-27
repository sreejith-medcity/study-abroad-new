-- Moves the NCLEX-RN (USA) files recorded on the NURSING pathway to the NCLEX
-- pathway. NOT run by the migration: the owner runs it by hand, after
-- migration 0088 and deploy/new-pathways.sql, once the counts printed by the
-- first block below have been checked. Run it with
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deploy/nclex-pathway.sql
--
-- Everything is in one transaction, so a failure changes nothing. Safe to run
-- twice: a second run finds nothing left to move and prints zeros.
--
-- What moves. A file's pathway is its programme's (applications have no pathway
-- of their own) and its status must belong to that pathway, so a programme is
-- moved with all its applications or not at all. A NURSING programme moves to
-- NCLEX only when
--   1. it is in the United States (the NCLEX-RN is the USA's licensing exam; a
--      UK NMC or German Anerkennung route stays NURSING even if a student on it
--      also has an NCLEX-RN case),
--   2. at least one application on it belongs to a student with an NCLEX-RN
--      case, and every application on it does (a programme shared with other
--      nursing students is left for the owner to decide),
--   3. every status its applications are at has an NCLEX status of the same
--      code (every NURSING code has one, so only a status the team added
--      to NURSING by hand can stop it).
-- Each application on a moved programme gets the NCLEX status with the same
-- code; its status date, history and NCLEX-RN steps are not touched. A student
-- with an NCLEX-RN case whose preferred pathway is NURSING, and who has no
-- application left on a NURSING programme, gets NCLEX as their preferred
-- pathway. Whatever is left is listed at the end with the reason.

\echo 'Before: NCLEX-RN cases, and where their applications stand'
SELECT 'students with an NCLEX-RN case' AS what, count(*) AS n FROM nclex_cases
UNION ALL
SELECT 'their applications on NURSING programmes', count(*)
FROM applications a JOIN programs p ON p.id = a.program_id
WHERE p.pathway = 'NURSING' AND EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = a.student_id)
UNION ALL
SELECT 'their applications on NCLEX programmes', count(*)
FROM applications a JOIN programs p ON p.id = a.program_id
WHERE p.pathway = 'NCLEX' AND EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = a.student_id)
UNION ALL
SELECT 'NCLEX statuses in the dictionary', count(*) FROM status_definitions WHERE pathway = 'NCLEX';

BEGIN;

-- Stop here, changing nothing, if deploy/new-pathways.sql has not been run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM status_definitions WHERE pathway = 'NCLEX') THEN
    RAISE EXCEPTION 'There are no NCLEX statuses yet: run deploy/new-pathways.sql first.';
  END IF;
END $$;

CREATE TEMP TABLE nclex_move ON COMMIT DROP AS
SELECT p.id, p.name
FROM programs p
JOIN universities u ON u.id = p.university_id
JOIN countries c ON c.id = u.country_id
WHERE p.pathway = 'NURSING'
  AND c.code = 'US'
  AND EXISTS (SELECT 1 FROM applications a JOIN nclex_cases n ON n.student_id = a.student_id WHERE a.program_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.program_id = p.id AND NOT EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = a.student_id))
  AND NOT EXISTS (
    SELECT 1 FROM applications a JOIN status_definitions s ON s.id = a.status_id
    WHERE a.program_id = p.id AND NOT EXISTS (SELECT 1 FROM status_definitions t WHERE t.pathway = 'NCLEX' AND t.code = s.code)
  );

CREATE TEMP TABLE nclex_moved_apps ON COMMIT DROP AS
SELECT a.id AS application_id, s.code
FROM applications a JOIN status_definitions s ON s.id = a.status_id
WHERE a.program_id IN (SELECT id FROM nclex_move);

-- Each application to the NCLEX status of the same code.
UPDATE applications a
SET status_id = t.id
FROM status_definitions s, status_definitions t
WHERE a.status_id = s.id
  AND a.program_id IN (SELECT id FROM nclex_move)
  AND t.pathway = 'NCLEX' AND t.code = s.code
  AND s.pathway <> 'NCLEX';

UPDATE programs SET pathway = 'NCLEX', updated_at = now() WHERE id IN (SELECT id FROM nclex_move);

-- Kept in the audit log, one line per programme, so the move can be read back.
INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, meta)
SELECT gen_random_uuid()::text, NULL, 'program.pathway_nclex', 'program', m.id,
       jsonb_build_object('from', 'NURSING', 'to', 'NCLEX', 'applications', (SELECT count(*) FROM applications a WHERE a.program_id = m.id), 'by', 'deploy/nclex-pathway.sql')
FROM nclex_move m;

CREATE TEMP TABLE nclex_moved_students ON COMMIT DROP AS
SELECT s.id
FROM students s
WHERE s.preferred_pathway = 'NURSING'
  AND EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM applications a JOIN programs p ON p.id = a.program_id WHERE a.student_id = s.id AND p.pathway = 'NURSING');

UPDATE students SET preferred_pathway = 'NCLEX' WHERE id IN (SELECT id FROM nclex_moved_students);

\echo 'Moved in this run'
SELECT 'programmes moved to NCLEX' AS what, count(*) AS n FROM nclex_move
UNION ALL SELECT 'applications moved to NCLEX', count(*) FROM nclex_moved_apps
UNION ALL SELECT 'students whose preferred pathway is now NCLEX', count(*) FROM nclex_moved_students;

\echo 'Statuses the moved applications are at'
SELECT code, count(*) AS applications FROM nclex_moved_apps GROUP BY code ORDER BY code;

\echo 'Left on NURSING: applications of students with an NCLEX-RN case, and why'
SELECT p.name AS programme, c.code AS country, count(*) AS applications,
  CASE
    WHEN c.code <> 'US' THEN 'not a USA programme'
    WHEN EXISTS (SELECT 1 FROM applications x WHERE x.program_id = p.id AND NOT EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = x.student_id)) THEN 'programme shared with students who have no NCLEX-RN case'
    ELSE 'a status with no NCLEX status of the same code'
  END AS reason
FROM applications a
JOIN programs p ON p.id = a.program_id
JOIN universities u ON u.id = p.university_id
JOIN countries c ON c.id = u.country_id
WHERE p.pathway = 'NURSING' AND EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = a.student_id)
GROUP BY p.id, p.name, c.code
ORDER BY p.name;

COMMIT;

\echo 'After'
SELECT 'NCLEX-RN case applications on NURSING programmes' AS what, count(*) AS n
FROM applications a JOIN programs p ON p.id = a.program_id
WHERE p.pathway = 'NURSING' AND EXISTS (SELECT 1 FROM nclex_cases n WHERE n.student_id = a.student_id)
UNION ALL
SELECT 'applications on NCLEX programmes', count(*)
FROM applications a JOIN programs p ON p.id = a.program_id WHERE p.pathway = 'NCLEX'
UNION ALL
SELECT 'applications whose status is not on their programme''s pathway', count(*)
FROM applications a JOIN programs p ON p.id = a.program_id JOIN status_definitions s ON s.id = a.status_id
WHERE s.pathway <> p.pathway;
