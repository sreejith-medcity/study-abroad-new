-- The surface each person reads the portal on: soft, glass or night.
-- Everybody starts where they already are, so the deploy changes nothing
-- until somebody picks something else in Settings.
--
-- Written with "if not exists" because this column was added by hand on the
-- live database before the migration existed, and a migration that cannot be
-- run twice is a migration that blocks the next deploy.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "skin" text DEFAULT 'soft' NOT NULL;
