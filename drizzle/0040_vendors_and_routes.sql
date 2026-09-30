CREATE TYPE "public"."payable_on" AS ENUM('OFFER_ACCEPTED', 'FEE_PAID', 'VISA_APPROVED', 'ENROLMENT_CONFIRMED');--> statement-breakpoint
CREATE TABLE "program_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"basis" "commission_basis" DEFAULT 'PERCENT_TUITION' NOT NULL,
	"percent_of_tuition" real,
	"flat_amount" integer,
	"currency" text,
	"payable_on" "payable_on",
	"days_to_pay" integer,
	"application_fee" integer,
	"offer_tat_days" integer,
	"vendor_course_code" text,
	"interview_required" boolean DEFAULT false NOT NULL,
	"extra_documents" text,
	"active" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"colour" text DEFAULT '#475569' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_direct" boolean DEFAULT false NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"portal_url" text,
	"billing_name" text,
	"billing_address" text,
	"gstin" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"payable_on" "payable_on" DEFAULT 'ENROLMENT_CONFIRMED' NOT NULL,
	"days_to_pay" integer DEFAULT 60 NOT NULL,
	"notes" text,
	"terms_confirmed_at" timestamp with time zone,
	"terms_confirmed_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "route_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "vendor_reference" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "route_chosen_by_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "route_chosen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "program_routes" ADD CONSTRAINT "program_routes_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_routes" ADD CONSTRAINT "program_routes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_routes" ADD CONSTRAINT "program_routes_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_terms_confirmed_by_id_users_id_fk" FOREIGN KEY ("terms_confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_routes_uq" ON "program_routes" USING btree ("program_id","vendor_id");--> statement-breakpoint
CREATE INDEX "program_routes_vendor_idx" ON "program_routes" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_uq" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_code_uq" ON "vendors" USING btree ("code");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_route_id_program_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."program_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_route_chosen_by_id_users_id_fk" FOREIGN KEY ("route_chosen_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;