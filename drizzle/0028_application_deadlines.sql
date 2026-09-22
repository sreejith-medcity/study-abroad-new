CREATE TYPE "public"."deadline_type" AS ENUM('APPLICATION', 'PAYMENT', 'CAS_REQUEST', 'OFFER_ACCEPTANCE', 'GS_SUBMISSION', 'ENROLMENT', 'VISA', 'COURSE_START', 'OTHER');--> statement-breakpoint
CREATE TABLE "application_deadlines" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"type" "deadline_type" NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"done_at" timestamp with time zone,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_deadlines" ADD CONSTRAINT "application_deadlines_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_deadlines" ADD CONSTRAINT "application_deadlines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_deadlines_due_idx" ON "application_deadlines" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "application_deadlines_app_idx" ON "application_deadlines" USING btree ("application_id");