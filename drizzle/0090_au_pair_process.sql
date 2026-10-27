-- The written Au pair process. The recorded moments it adds to fsj_events,
-- and the facts only its guide asks for on the application. New enum values
-- are not used in this transaction: the statuses, the document types and the
-- requirements are in deploy/au-pair-pathway.sql, run after this.
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'MENTOR';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'MOCK_INTERVIEW';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'PROFILE_SUBMITTED';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'HOST_FAMILY';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'CONTRACT';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'APPOINTMENT';--> statement-breakpoint
ALTER TYPE "public"."fsj_event_kind" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_consent_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_platform" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_pocket_money" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_weekly_hours" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_duration_months" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_appointment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "au_pair_appointment_place" text;
