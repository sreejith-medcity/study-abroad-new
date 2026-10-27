-- Three new pathways: NCLEX-RN (USA) as a pathway of its own, Weiterbildung and CCM.
-- A new enum value cannot be used in the transaction that adds it, so the statuses
-- and requirements for them are in deploy/new-pathways.sql, run after this.
ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS 'NCLEX';--> statement-breakpoint
ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS 'WEITERBILDUNG';--> statement-breakpoint
ALTER TYPE "public"."pathway" ADD VALUE IF NOT EXISTS 'CCM';
