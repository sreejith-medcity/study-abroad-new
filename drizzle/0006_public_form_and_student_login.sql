ALTER TABLE "organizations" ADD COLUMN "public_slug" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "public_form_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_public_slug_unique" UNIQUE("public_slug");