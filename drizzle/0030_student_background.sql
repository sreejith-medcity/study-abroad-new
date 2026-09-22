CREATE TYPE "public"."application_priority" AS ENUM('HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TABLE "student_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"relation" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"emergency" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "priority" "application_priority" DEFAULT 'NORMAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "mailing_same_as_permanent" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "mailing_address" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "other_citizenship" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "living_in_country" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "background" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "student_contacts" ADD CONSTRAINT "student_contacts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_contacts_student_idx" ON "student_contacts" USING btree ("student_id");