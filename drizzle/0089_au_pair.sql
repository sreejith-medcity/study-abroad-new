-- Au pair as a pathway of its own. A new enum value cannot be used in the
-- transaction that adds it, so its statuses and requirements are in
-- deploy/au-pair-pathway.sql, run after this.
ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS 'AU_PAIR';
