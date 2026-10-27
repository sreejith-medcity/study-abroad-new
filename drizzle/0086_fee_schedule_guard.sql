ALTER TYPE "public"."fee_instalment_state" ADD VALUE 'WAIVED';--> statement-breakpoint
ALTER TYPE "public"."fee_instalment_state" ADD VALUE 'SKIPPED';--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD COLUMN "closed_by_id" text;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_note_number" text;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_note_on" date;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_taxable" integer;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_cgst" integer;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_sgst" integer;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD COLUMN "credit_igst" integer;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_instalments_live_uq" ON "fee_instalments" USING btree ("student_id","seq") WHERE state in ('SCHEDULED', 'INVOICED');--> statement-breakpoint
CREATE UNIQUE INDEX "fee_refunds_credit_note_uq" ON "fee_refunds" USING btree ("credit_note_number");--> statement-breakpoint
UPDATE "fee_plans" SET "note" = 'Candidate must additionally pay a refundable €1,000 to the employer.', "updated_at" = now() WHERE "starter_key" = 'ausbildung-nursing-without-interview' AND "note" IS NULL;
