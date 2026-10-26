CREATE TABLE "ledger_head" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"head_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_stamps" (
	"id" text PRIMARY KEY NOT NULL,
	"upto_seq" integer NOT NULL,
	"head_hash" text NOT NULL,
	"statement" text NOT NULL,
	"digest" text NOT NULL,
	"proof" text,
	"calendars" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ownership_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"org_id" text,
	"org_name" text,
	"owner_id" text,
	"owner_name" text,
	"prev_org_id" text,
	"prev_org_name" text,
	"prev_owner_id" text,
	"prev_owner_name" text,
	"detail" text,
	"actor_id" text,
	"actor_name" text,
	"created_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"org_id" text,
	"student_id" text,
	"changes" jsonb NOT NULL,
	"action" text NOT NULL,
	"changed_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_versions" ADD CONSTRAINT "record_versions_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_stamps_time_idx" ON "ledger_stamps" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_ledger_seq_uq" ON "ownership_ledger" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "ownership_ledger_entity_idx" ON "ownership_ledger" USING btree ("entity","entity_id","seq");--> statement-breakpoint
CREATE INDEX "record_versions_entity_idx" ON "record_versions" USING btree ("entity","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "record_versions_time_idx" ON "record_versions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "record_versions_org_idx" ON "record_versions" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "record_versions_by_idx" ON "record_versions" USING btree ("changed_by_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "record_versions_student_idx" ON "record_versions" USING btree ("student_id");