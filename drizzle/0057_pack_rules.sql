CREATE TYPE "public"."pack_shape" AS ENUM('FOLDER', 'ONE_PDF');--> statement-breakpoint
ALTER TABLE "submission_packs" ADD COLUMN "included" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "pack_shape" "pack_shape" DEFAULT 'FOLDER' NOT NULL;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "pack_naming" text;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "pack_limit_mb" integer;