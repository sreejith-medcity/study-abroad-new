ALTER TYPE "public"."study_level" ADD VALUE 'TOP_UP' BEFORE 'VOCATIONAL';--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "preferred_level" "study_level";