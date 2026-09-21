ALTER TYPE "public"."study_level" ADD VALUE 'CERTIFICATE';--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "tuition_total" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "external_code" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "external_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "programs_external_code_uq" ON "programs" USING btree ("external_code");--> statement-breakpoint
CREATE INDEX "programs_university_idx" ON "programs" USING btree ("university_id");--> statement-breakpoint
CREATE UNIQUE INDEX "universities_external_code_uq" ON "universities" USING btree ("external_code");