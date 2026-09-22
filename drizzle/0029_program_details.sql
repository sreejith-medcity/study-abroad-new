ALTER TABLE "programs" ADD COLUMN "program_url" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "min_ielts_band" real;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "entry_requirements" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "balance_deposit" integer;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "typical_scholarship" text;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "tags" text[] DEFAULT '{}'::text[] NOT NULL;