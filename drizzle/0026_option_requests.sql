CREATE TYPE "public"."options_status" AS ENUM('REQUESTED', 'OPTIONS_SENT', 'APPLIED');--> statement-breakpoint
CREATE TABLE "option_request_files" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_request_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_request_programs" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"program_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_no" text NOT NULL,
	"org_id" text NOT NULL,
	"requested_by_id" text,
	"student_id" text,
	"student_name" text NOT NULL,
	"education_country" text,
	"highest_level" text,
	"destinations" text[] DEFAULT '{}'::text[] NOT NULL,
	"study_levels" text[] DEFAULT '{}'::text[] NOT NULL,
	"study_areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"additional_info" text,
	"status" "options_status" DEFAULT 'REQUESTED' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"assigned_to_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "option_requests_request_no_unique" UNIQUE("request_no")
);
--> statement-breakpoint
ALTER TABLE "option_request_files" ADD CONSTRAINT "option_request_files_request_id_option_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."option_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_request_files" ADD CONSTRAINT "option_request_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_request_messages" ADD CONSTRAINT "option_request_messages_request_id_option_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."option_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_request_messages" ADD CONSTRAINT "option_request_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_request_programs" ADD CONSTRAINT "option_request_programs_request_id_option_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."option_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_request_programs" ADD CONSTRAINT "option_request_programs_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_requests" ADD CONSTRAINT "option_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_requests" ADD CONSTRAINT "option_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_requests" ADD CONSTRAINT "option_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_requests" ADD CONSTRAINT "option_requests_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "option_request_programs_uq" ON "option_request_programs" USING btree ("request_id","program_id");--> statement-breakpoint
CREATE INDEX "option_requests_org_idx" ON "option_requests" USING btree ("org_id");