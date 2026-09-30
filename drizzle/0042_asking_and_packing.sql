CREATE TYPE "public"."request_channel" AS ENUM('WHATSAPP', 'PORTAL');--> statement-breakpoint
CREATE TYPE "public"."request_kind" AS ENUM('ASK', 'NUDGE');--> statement-breakpoint
CREATE TABLE "document_request_items" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"item_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"kind" "request_kind" DEFAULT 'ASK' NOT NULL,
	"channel" "request_channel" DEFAULT 'PORTAL' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"due_on" date,
	"item_count" integer DEFAULT 0 NOT NULL,
	"sent_by_id" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"student_id" text NOT NULL,
	"built_by_id" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD COLUMN "expiry_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "gate_notice_stage" "journey_stage";--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_request_id_document_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."document_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_message_id_outbound_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outbound_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_packs" ADD CONSTRAINT "submission_packs_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_packs" ADD CONSTRAINT "submission_packs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_packs" ADD CONSTRAINT "submission_packs_built_by_id_users_id_fk" FOREIGN KEY ("built_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_request_items_uq" ON "document_request_items" USING btree ("request_id","item_id");--> statement-breakpoint
CREATE INDEX "document_requests_student_idx" ON "document_requests" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "submission_packs_application_idx" ON "submission_packs" USING btree ("application_id");