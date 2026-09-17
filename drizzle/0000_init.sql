CREATE TYPE "public"."comment_channel" AS ENUM('TEAM', 'STUDENT');--> statement-breakpoint
CREATE TYPE "public"."edit_request_status" AS ENUM('OPEN', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."fee_status" AS ENUM('NOT_APPLICABLE', 'DUE', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('WEB', 'WHATSAPP', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."org_type" AS ENUM('HQ', 'BRANCH', 'SUB_AGENT');--> statement-breakpoint
CREATE TYPE "public"."pathway" AS ENUM('DEGREE', 'AUSBILDUNG', 'NURSING');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('DRAFT', 'LIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MANAGEMENT', 'PARTNER', 'COUNSELLOR', 'STUDENT');--> statement-breakpoint
CREATE TYPE "public"."status_group" AS ENUM('NEW', 'PENDING_PARTNER', 'IN_PROGRESS', 'OFFER', 'SUCCESS', 'HOLD', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."study_level" AS ENUM('SCHOOL', 'UG_DIPLOMA', 'UG', 'PG_DIPLOMA', 'PG', 'PHD', 'VOCATIONAL', 'REGISTRATION');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('SILVER', 'GOLD', 'ELITE', 'PLATINUM');--> statement-breakpoint
CREATE TABLE "academic_records" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"level" "study_level" NOT NULL,
	"institution" text NOT NULL,
	"course" text,
	"grading_system" text,
	"score" real,
	"year_completed" integer
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"ack_no" text NOT NULL,
	"student_id" text NOT NULL,
	"program_id" text NOT NULL,
	"org_id" text NOT NULL,
	"intake_month" integer NOT NULL,
	"intake_year" integer NOT NULL,
	"status_id" text NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"officer_id" text,
	"created_by_id" text NOT NULL,
	"deadline" timestamp,
	"fee_status" "fee_status" DEFAULT 'NOT_APPLICABLE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_ack_no_unique" UNIQUE("ack_no")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"channel" "comment_channel" NOT NULL,
	"body" text NOT NULL,
	"source" "message_source" DEFAULT 'WEB' NOT NULL,
	"author_id" text,
	"author_label" text,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "countries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"uploaded_by" text DEFAULT 'partner' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"application_id" text,
	"comment_id" text,
	"type_code" text,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"section" text NOT NULL,
	"message" text NOT NULL,
	"status" "edit_request_status" DEFAULT 'OPEN' NOT NULL,
	"requested_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "org_type" NOT NULL,
	"tier" "tier" DEFAULT 'SILVER' NOT NULL,
	"city" text,
	"counsellor_seats" integer DEFAULT 3 NOT NULL,
	"relationship_manager_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"template" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"university_id" text NOT NULL,
	"pathway" "pathway" DEFAULT 'DEGREE' NOT NULL,
	"level" "study_level" NOT NULL,
	"study_area" text,
	"duration_months" integer,
	"tuition_per_year" integer,
	"application_fee" integer DEFAULT 0 NOT NULL,
	"initial_deposit" integer,
	"intake_months" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"min_ielts" real,
	"min_pte" integer,
	"min_oet_grade" text,
	"min_german_level" text,
	"max_backlogs" integer,
	"max_gap_years" integer,
	"moi_accepted" boolean DEFAULT false NOT NULL,
	"required_docs" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "program_status" DEFAULT 'LIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"pathway" "pathway" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"student_label" text NOT NULL,
	"group" "status_group" NOT NULL,
	"sort_order" integer NOT NULL,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"from_status_id" text,
	"to_status_id" text NOT NULL,
	"reason" text,
	"changed_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"created_by_id" text,
	"assigned_to_id" text,
	"user_id" text,
	"portal_token" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"whatsapp_opt_in" boolean DEFAULT true NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"preferred_country" text,
	"preferred_pathway" "pathway",
	"date_of_birth" timestamp,
	"gender" text,
	"marital_status" text,
	"nationality" text DEFAULT 'India' NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"pincode" text,
	"passport_number" text,
	"passport_issue" timestamp,
	"passport_expiry" timestamp,
	"passport_issue_country" text,
	"city_of_birth" text,
	"backlogs" integer,
	"gap_years" integer,
	"consent_at" timestamp with time zone,
	"consent_text" text,
	"profile_locked" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'partner' NOT NULL,
	"crm_lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_portal_token_unique" UNIQUE("portal_token")
);
--> statement-breakpoint
CREATE TABLE "test_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"test" text NOT NULL,
	"overall" text NOT NULL,
	"taken_on" timestamp,
	"is_mock" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "universities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country_id" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"org_id" text NOT NULL,
	"desk_label" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_experience" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"employer" text NOT NULL,
	"title" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp
);
--> statement-breakpoint
ALTER TABLE "academic_records" ADD CONSTRAINT "academic_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_status_id_status_definitions_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."status_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_officer_id_users_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_from_status_id_status_definitions_id_fk" FOREIGN KEY ("from_status_id") REFERENCES "public"."status_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_to_status_id_status_definitions_id_fk" FOREIGN KEY ("to_status_id") REFERENCES "public"."status_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scores" ADD CONSTRAINT "test_scores_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "universities" ADD CONSTRAINT "universities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_experience" ADD CONSTRAINT "work_experience_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_org_idx" ON "applications" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "programs_name_idx" ON "programs" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "status_pathway_code_uq" ON "status_definitions" USING btree ("pathway","code");--> statement-breakpoint
CREATE INDEX "students_org_idx" ON "students" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "students_email_idx" ON "students" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "universities_name_country_uq" ON "universities" USING btree ("name","country_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");