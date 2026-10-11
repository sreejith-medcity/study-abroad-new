ALTER TABLE "test_scores" ALTER COLUMN "overall" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "test_scores" ADD COLUMN "state" text DEFAULT 'TAKEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_scores" ADD COLUMN "listening" text;--> statement-breakpoint
ALTER TABLE "test_scores" ADD COLUMN "reading" text;--> statement-breakpoint
ALTER TABLE "test_scores" ADD COLUMN "writing" text;--> statement-breakpoint
ALTER TABLE "test_scores" ADD COLUMN "speaking" text;