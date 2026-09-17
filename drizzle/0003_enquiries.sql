CREATE TYPE "public"."enquiry_source" AS ENUM('WALK_IN', 'PHONE', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'EVENT', 'SOCIAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."enquiry_stage" AS ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'COUNSELLING', 'CONVERTED', 'LOST');--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"assigned_to_id" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"city" text,
	"source" "enquiry_source" DEFAULT 'WALK_IN' NOT NULL,
	"stage" "enquiry_stage" DEFAULT 'NEW' NOT NULL,
	"interest_country" text,
	"interest_pathway" "pathway",
	"intake_month" integer,
	"intake_year" integer,
	"budget_lakhs" real,
	"notes" text,
	"next_follow_up_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"lost_reason" text,
	"student_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiry_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"enquiry_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"stage_after" "enquiry_stage",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_notes" ADD CONSTRAINT "enquiry_notes_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_notes" ADD CONSTRAINT "enquiry_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiries_org_idx" ON "enquiries" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "enquiries_follow_up_idx" ON "enquiries" USING btree ("next_follow_up_at");--> statement-breakpoint
CREATE INDEX "enquiry_notes_idx" ON "enquiry_notes" USING btree ("enquiry_id");