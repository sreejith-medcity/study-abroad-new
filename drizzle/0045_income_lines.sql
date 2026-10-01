CREATE TYPE "public"."income_kind" AS ENUM('SERVICE_FEE', 'COMMISSION', 'TICKET', 'SIM', 'FOREX', 'INSURANCE', 'ACCOMMODATION', 'PICKUP', 'LOAN_REFERRAL', 'COACHING_FEE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."income_payer" AS ENUM('STUDENT', 'VENDOR', 'PROVIDER', 'UNIVERSITY');--> statement-breakpoint
CREATE TYPE "public"."income_state" AS ENUM('EXPECTED', 'INVOICED', 'RECEIVED', 'WRITTEN_OFF', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TABLE "income_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"student_id" text NOT NULL,
	"application_id" text,
	"kind" "income_kind" NOT NULL,
	"payer" "income_payer" DEFAULT 'STUDENT' NOT NULL,
	"vendor_id" text,
	"provider_name" text,
	"commission_id" text,
	"service_request_id" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"expected_amount" integer,
	"invoiced_amount" integer,
	"received_amount" integer,
	"state" "income_state" DEFAULT 'EXPECTED' NOT NULL,
	"branch_share_percent" real,
	"rate_card_id" text,
	"due_on" date,
	"received_on" date,
	"note" text,
	"written_off_reason" text,
	"written_off_by_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"kind" "income_kind" NOT NULL,
	"amount" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"percent_of_sale" real,
	"payer" "income_payer" DEFAULT 'STUDENT' NOT NULL,
	"branch_share_percent" real,
	"active_from" date NOT NULL,
	"note" text,
	"set_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "income_line_id" text;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_service_request_id_service_requests_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_written_off_by_id_users_id_fk" FOREIGN KEY ("written_off_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_lines" ADD CONSTRAINT "income_lines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "income_lines_student_idx" ON "income_lines" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "income_lines_org_idx" ON "income_lines" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "income_lines_vendor_idx" ON "income_lines" USING btree ("vendor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "income_lines_service_uq" ON "income_lines" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "rate_cards_kind_idx" ON "rate_cards" USING btree ("kind","active_from");--> statement-breakpoint
CREATE INDEX "rate_cards_org_idx" ON "rate_cards" USING btree ("org_id");