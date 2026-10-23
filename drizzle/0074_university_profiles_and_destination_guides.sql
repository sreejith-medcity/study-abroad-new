ALTER TABLE "countries" ADD COLUMN "guide" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "capital" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "languages" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "climate" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "accommodation" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "faqs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "mioc_filled" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "facts" text[] DEFAULT '{}'::text[] NOT NULL;