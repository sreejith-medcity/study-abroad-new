CREATE TABLE "catalogue_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by_id" text,
	"source" text NOT NULL,
	"batch_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "replaces_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "superseded_by_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "removed_by_id" text;--> statement-breakpoint
ALTER TABLE "catalogue_changes" ADD CONSTRAINT "catalogue_changes_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_changes_entity_idx" ON "catalogue_changes" USING btree ("entity","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalogue_changes_batch_idx" ON "catalogue_changes" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_replaces_id_documents_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_superseded_by_id_users_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_removed_by_id_users_id_fk" FOREIGN KEY ("removed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_replaces_idx" ON "documents" USING btree ("replaces_id");--> statement-breakpoint
CREATE INDEX "documents_current_idx" ON "documents" USING btree ("student_id","type_code") WHERE superseded_at is null and removed_at is null;