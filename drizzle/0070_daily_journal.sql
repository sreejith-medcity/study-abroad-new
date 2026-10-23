CREATE TYPE "public"."journal_state" AS ENUM('VERIFIED', 'FLAGGED', 'MISSED');--> statement-breakpoint
CREATE TABLE "daily_journals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"viewed_at" timestamp with time zone,
	"state" "journal_state",
	"decided_at" timestamp with time zone,
	"note" text,
	"entries" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_days" (
	"day" date PRIMARY KEY NOT NULL,
	"issued_at" timestamp with time zone,
	"report_sent_at" timestamp with time zone,
	"report_reason" text
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "journal_day_end" text DEFAULT '17:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "journal_out_of_hours" text DEFAULT '17:45' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "journal_cutoff" text DEFAULT '19:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "journal_on_sundays" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_journals" ADD CONSTRAINT "daily_journals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_journals_user_day_uq" ON "daily_journals" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "daily_journals_day_idx" ON "daily_journals" USING btree ("day");--> statement-breakpoint
CREATE INDEX "audit_actor_time_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "checklist_files_decider_idx" ON "checklist_files" USING btree ("decided_by_id","decided_at");--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_log_by_idx" ON "contact_log" USING btree ("by_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_uploader_idx" ON "documents" USING btree ("uploaded_by_id","created_at");--> statement-breakpoint
CREATE INDEX "status_history_changer_idx" ON "status_history" USING btree ("changed_by_id","created_at");