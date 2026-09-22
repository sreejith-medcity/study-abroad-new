CREATE TABLE "prep_courses" (
	"id" text PRIMARY KEY NOT NULL,
	"test" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"mode" text NOT NULL,
	"duration_weeks" integer,
	"fee_inr" integer,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "prep_page_enabled" boolean DEFAULT false NOT NULL;