ALTER TABLE "countries" ADD COLUMN "visa_living_funds" integer;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "visa_living_note" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "visa_living_source" text;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "visa_living_checked" date;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "qs_rank" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "qs_year" integer;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "the_rank" text;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "the_year" integer;--> statement-breakpoint
ALTER TABLE "universities" ADD COLUMN "rank_sort" integer;