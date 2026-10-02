CREATE TYPE "public"."integration_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('PENDING', 'SENT', 'RECEIVED', 'FAILED', 'NEEDS_A_PERSON', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" "integration_direction" NOT NULL,
	"kind" text NOT NULL,
	"status" "integration_status" DEFAULT 'PENDING' NOT NULL,
	"integration_key_id" text,
	"idempotency_key" text,
	"entity_type" text,
	"entity_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response" jsonb,
	"response_status" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"error" text,
	"needs_a_person_because" text,
	"resolved_by_id" text,
	"resolved_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_box" text,
	"signature_required" boolean DEFAULT false NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "crm_webhook_url" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "crm_webhook_secret_box" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "crm_webhook_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "crm_webhook_kinds" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "crm_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "crm_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "crm_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "crm_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integration_key_id_integration_keys_id_fk" FOREIGN KEY ("integration_key_id") REFERENCES "public"."integration_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_events_idempotency_uq" ON "integration_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_events_status_idx" ON "integration_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "integration_events_due_idx" ON "integration_events" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "integration_events_entity_idx" ON "integration_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_keys_key_id_uq" ON "integration_keys" USING btree ("key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_crm_id_uq" ON "enquiries" USING btree ("crm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_crm_id_uq" ON "students" USING btree ("crm_id");