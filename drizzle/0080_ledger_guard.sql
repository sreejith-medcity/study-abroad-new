-- The ownership ledger is append-only: the database refuses to change or remove
-- an entry, whoever asks. Somebody with the rights to switch this off can still
-- edit an entry, and Verify on /admin/ledger then reports it by number, because
-- the entry no longer matches its hash.
CREATE OR REPLACE FUNCTION ownership_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The ownership ledger is append-only: entries cannot be changed or deleted';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ownership_ledger_guard ON ownership_ledger;
--> statement-breakpoint
CREATE TRIGGER ownership_ledger_guard BEFORE UPDATE OR DELETE ON ownership_ledger FOR EACH ROW EXECUTE FUNCTION ownership_ledger_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ownership_ledger_guard_truncate ON ownership_ledger;
--> statement-breakpoint
CREATE TRIGGER ownership_ledger_guard_truncate BEFORE TRUNCATE ON ownership_ledger FOR EACH STATEMENT EXECUTE FUNCTION ownership_ledger_guard();
