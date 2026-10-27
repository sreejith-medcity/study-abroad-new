ALTER TYPE "public"."pathway" ADD VALUE 'FSJ';--> statement-breakpoint
ALTER TYPE "public"."pathway" ADD VALUE 'BFD';--> statement-breakpoint
CREATE TYPE "public"."fsj_event_kind" AS ENUM('LANGUAGE_ASSESSMENT', 'DOCUMENTS_MISSING', 'FEE_CHECK', 'INTERVIEW', 'FEEDBACK', 'OFFER', 'VFS_SLOT', 'VISA_SUBMITTED', 'VISA_DECISION', 'HANDOVER', 'NOTICE');--> statement-breakpoint
CREATE TYPE "public"."fsj_feedback" AS ENUM('POSITIVE', 'SECOND_ROUND', 'NOT_SELECTED');--> statement-breakpoint
CREATE TYPE "public"."fsj_language_result" AS ENUM('SUFFICIENT', 'NOT_SUFFICIENT');--> statement-breakpoint
CREATE TABLE "fsj_events" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"student_id" text NOT NULL,
	"kind" "fsj_event_kind" NOT NULL,
	"step" integer NOT NULL,
	"outcome" text,
	"level" text,
	"employer" text,
	"at" timestamp with time zone,
	"on" date,
	"link" text,
	"detail" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_registration_fee_paid_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_agreement_signed_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_application_fee_paid_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_offer_payment_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_pre_visa_payment_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_application_started_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_language_level" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_language_result" "fsj_language_result";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_language_assessed_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_employer" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_interview_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_interview_link" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_responsibilities" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_requirements" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_feedback" "fsj_feedback";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_offer_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_contract_signed_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_vfs_slot_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_visa_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_joining_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_departed_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "fsj_done" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "fsj_events" ADD CONSTRAINT "fsj_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsj_events" ADD CONSTRAINT "fsj_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fsj_events" ADD CONSTRAINT "fsj_events_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fsj_events_application_idx" ON "fsj_events" USING btree ("application_id","created_at");