-- The surface each person reads the portal on: soft, glass or night.
-- Everybody starts where they already are, so the deploy changes nothing
-- until somebody picks something else in Settings.
alter table "users" add column if not exists "skin" text not null default 'soft';
