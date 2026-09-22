CREATE TYPE "public"."bulletin_kind" AS ENUM('UPDATE', 'ANNOUNCEMENT', 'WHATS_NEW');--> statement-breakpoint
CREATE TABLE "bulletins" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "bulletin_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"university_id" text,
	"intakes" text,
	"cta_label" text,
	"cta_url" text,
	"published" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whats_new_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulletins" ADD CONSTRAINT "bulletins_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulletins_kind_idx" ON "bulletins" USING btree ("kind","created_at");