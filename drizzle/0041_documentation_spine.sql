CREATE TYPE "public"."checklist_state" AS ENUM('NOT_NEEDED', 'NOT_ASKED', 'ASKED', 'UPLOADED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."journey_stage" AS ENUM('PROFILE', 'SHORTLIST', 'APPLICATION', 'OFFER', 'DEPOSIT', 'CONFIRMATION', 'VISA', 'DEPARTURE', 'ARRIVED');--> statement-breakpoint
CREATE TYPE "public"."owed_by" AS ENUM('STUDENT', 'MEDCITY', 'UNIVERSITY', 'VENDOR');--> statement-breakpoint
CREATE TYPE "public"."requirement_source" AS ENUM('ALWAYS', 'DESTINATION', 'ROUTE', 'UNIVERSITY', 'STUDENT');--> statement-breakpoint
CREATE TABLE "checklist_files" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"document_id" text,
	"version" integer NOT NULL,
	"outcome" "checklist_state",
	"reason_code" text,
	"reason" text,
	"uploaded_by_id" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_id" text
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"application_id" text,
	"requirement_id" text,
	"stage" "journey_stage" NOT NULL,
	"type_code" text NOT NULL,
	"source" "requirement_source" DEFAULT 'ALWAYS' NOT NULL,
	"source_label" text,
	"required" boolean DEFAULT true NOT NULL,
	"owed_by" "owed_by" DEFAULT 'STUDENT' NOT NULL,
	"state" "checklist_state" DEFAULT 'NOT_ASKED' NOT NULL,
	"asked_at" timestamp with time zone,
	"asked_by_id" text,
	"asked_channel" text,
	"last_chased_at" timestamp with time zone,
	"chase_count" integer DEFAULT 0 NOT NULL,
	"due_on" date,
	"document_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	"issued_on" date,
	"valid_to" date,
	"validity_months" integer,
	"reason_code" text,
	"reason" text,
	"decided_at" timestamp with time zone,
	"decided_by_id" text,
	"claimed_by_id" text,
	"claimed_at" timestamp with time zone,
	"note" text,
	"added_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" "journey_stage" NOT NULL,
	"type_code" text NOT NULL,
	"source" "requirement_source" DEFAULT 'ALWAYS' NOT NULL,
	"country_id" text,
	"vendor_id" text,
	"university_id" text,
	"program_id" text,
	"required" boolean DEFAULT true NOT NULL,
	"owed_by" "owed_by" DEFAULT 'STUDENT' NOT NULL,
	"validity_months" integer,
	"guidance" text,
	"guidance_ml" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"application_id" text,
	"stage" "journey_stage" NOT NULL,
	"reason" text NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejection_reasons" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"label_ml" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "hold_applications_on_documents" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "journey_stage" "journey_stage" DEFAULT 'PROFILE' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "stage_entered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_item_id_checklist_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_reason_code_rejection_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."rejection_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_files" ADD CONSTRAINT "checklist_files_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_requirement_id_document_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_asked_by_id_users_id_fk" FOREIGN KEY ("asked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_reason_code_rejection_reasons_code_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."rejection_reasons"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_claimed_by_id_users_id_fk" FOREIGN KEY ("claimed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_type_code_document_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "public"."document_types"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_overrides" ADD CONSTRAINT "gate_overrides_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_overrides" ADD CONSTRAINT "gate_overrides_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_overrides" ADD CONSTRAINT "gate_overrides_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_files_version_uq" ON "checklist_files" USING btree ("item_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_items_student_type_uq" ON "checklist_items" USING btree ("student_id","type_code");--> statement-breakpoint
CREATE INDEX "checklist_items_state_idx" ON "checklist_items" USING btree ("state");--> statement-breakpoint
CREATE INDEX "checklist_items_stage_idx" ON "checklist_items" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "checklist_items_claimed_idx" ON "checklist_items" USING btree ("claimed_by_id");--> statement-breakpoint
CREATE INDEX "document_requirements_stage_idx" ON "document_requirements" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "document_requirements_country_idx" ON "document_requirements" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "document_requirements_vendor_idx" ON "document_requirements" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "document_requirements_university_idx" ON "document_requirements" USING btree ("university_id");--> statement-breakpoint
CREATE INDEX "document_requirements_program_idx" ON "document_requirements" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "gate_overrides_student_idx" ON "gate_overrides" USING btree ("student_id");