CREATE TYPE "public"."desk_stage" AS ENUM('PREPARING', 'READY', 'CHOSEN', 'SUBMITTED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."vendor_outcome" AS ENUM('ACKNOWLEDGED', 'DOCUMENTS_ASKED', 'INTERVIEW_SET', 'OFFER_ISSUED', 'CONDITIONS_MET', 'REJECTED', 'DEFERRED', 'WITHDRAWN', 'OTHER');--> statement-breakpoint
CREATE TABLE "vendor_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"outcome" "vendor_outcome" NOT NULL,
	"happened_on" date NOT NULL,
	"note" text,
	"to_status_id" text,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "desk_stage" "desk_stage" DEFAULT 'PREPARING' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "desk_stage_assumed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "handed_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "handed_over_by_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "handover_note" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "returned_by_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submitted_to_vendor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submitted_by_id" text;--> statement-breakpoint
ALTER TABLE "vendor_updates" ADD CONSTRAINT "vendor_updates_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_updates" ADD CONSTRAINT "vendor_updates_to_status_id_status_definitions_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."status_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_updates" ADD CONSTRAINT "vendor_updates_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vendor_updates_application_idx" ON "vendor_updates" USING btree ("application_id","happened_on");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_handed_over_by_id_users_id_fk" FOREIGN KEY ("handed_over_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_returned_by_id_users_id_fk" FOREIGN KEY ("returned_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;