CREATE TYPE "public"."work_rights" AS ENUM('UNKNOWN', 'ELIGIBLE', 'INELIGIBLE');--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "work_rights" "work_rights" DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "work_rights_note" text;