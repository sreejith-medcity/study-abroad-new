ALTER TYPE "public"."contact_outcome" ADD VALUE 'SWITCHED_OFF';--> statement-breakpoint
ALTER TYPE "public"."contact_outcome" ADD VALUE 'ENROLLED_ELSEWHERE';--> statement-breakpoint
ALTER TABLE "contact_log" ALTER COLUMN "student_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_log" ADD COLUMN "enquiry_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "enquiry_id" text;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_log_enquiry_idx" ON "contact_log" USING btree ("enquiry_id","happened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_enquiry_open_uq" ON "tasks" USING btree ("enquiry_id") WHERE "tasks"."done_at" is null;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_one_subject" CHECK (num_nonnulls("contact_log"."student_id", "contact_log"."enquiry_id") = 1);