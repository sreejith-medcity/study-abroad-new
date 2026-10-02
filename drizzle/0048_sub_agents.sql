CREATE TYPE "public"."agent_application_status" AS ENUM('NEW', 'REVIEWING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."agent_fee_kind" AS ENUM('SHARE_OF_COMMISSION', 'FLAT_PER_ENROLMENT');--> statement-breakpoint
CREATE TYPE "public"."referral_earning_state" AS ENUM('PENDING', 'PAYABLE', 'PAID', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."wallet_entry_kind" ADD VALUE 'REFERRAL';--> statement-breakpoint
CREATE TABLE "agent_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_name" text NOT NULL,
	"firm_name" text,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"city" text,
	"state" text,
	"about_them" text,
	"referred_by_org_id" text,
	"status" "agent_application_status" DEFAULT 'NEW' NOT NULL,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"decision_note" text,
	"org_id" text,
	"consent_at" timestamp with time zone,
	"consent_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text,
	"kind" "agent_fee_kind" NOT NULL,
	"percent" real,
	"flat_amount_inr" integer,
	"active_from" date NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mou_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"mou_version_id" text NOT NULL,
	"accepted_by_id" text NOT NULL,
	"accepted_name" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mou_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"effective_from" date,
	"active" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"student_id" text NOT NULL,
	"application_id" text,
	"commission_id" text,
	"kind" "agent_fee_kind",
	"rate_id" text,
	"amount_inr" integer,
	"state" "referral_earning_state" DEFAULT 'PENDING' NOT NULL,
	"wallet_entry_id" text,
	"payable_at" timestamp with time zone,
	"cancelled_reason" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "agent_signup_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "min_withdrawal_inr" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "require_mou_before_portal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "submitted_by_org_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "parent_org_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "referred_by_org_id" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_referred_by_org_id_organizations_id_fk" FOREIGN KEY ("referred_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD CONSTRAINT "agent_applications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rates" ADD CONSTRAINT "agent_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_rates" ADD CONSTRAINT "agent_rates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mou_acceptances" ADD CONSTRAINT "mou_acceptances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mou_acceptances" ADD CONSTRAINT "mou_acceptances_mou_version_id_mou_versions_id_fk" FOREIGN KEY ("mou_version_id") REFERENCES "public"."mou_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mou_acceptances" ADD CONSTRAINT "mou_acceptances_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mou_versions" ADD CONSTRAINT "mou_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_rate_id_agent_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."agent_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_wallet_entry_id_wallet_entries_id_fk" FOREIGN KEY ("wallet_entry_id") REFERENCES "public"."wallet_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_applications_status_idx" ON "agent_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_applications_phone_idx" ON "agent_applications" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "agent_rates_scope_idx" ON "agent_rates" USING btree ("org_id","active_from");--> statement-breakpoint
CREATE UNIQUE INDEX "mou_acceptances_org_version_uq" ON "mou_acceptances" USING btree ("org_id","mou_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mou_versions_version_uq" ON "mou_versions" USING btree ("version");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_earnings_student_uq" ON "referral_earnings" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "referral_earnings_org_idx" ON "referral_earnings" USING btree ("org_id","state");--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_submitted_by_org_id_organizations_id_fk" FOREIGN KEY ("submitted_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_org_id_organizations_id_fk" FOREIGN KEY ("parent_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_referred_by_org_id_organizations_id_fk" FOREIGN KEY ("referred_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiries_referrer_idx" ON "enquiries" USING btree ("submitted_by_org_id");