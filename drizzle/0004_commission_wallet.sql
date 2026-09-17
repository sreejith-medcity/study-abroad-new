CREATE TYPE "public"."commission_basis" AS ENUM('PERCENT_TUITION', 'FLAT');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('EXPECTED', 'INVOICED', 'RECEIVED', 'SETTLED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."wallet_entry_kind" AS ENUM('COMMISSION', 'PAYOUT', 'BONUS', 'ADJUSTMENT');--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"country_id" text,
	"university_id" text,
	"program_id" text,
	"intake_year" integer,
	"basis" "commission_basis" DEFAULT 'PERCENT_TUITION' NOT NULL,
	"percent_of_tuition" real,
	"flat_amount" integer,
	"currency" text DEFAULT 'INR' NOT NULL,
	"partner_share_percent" real DEFAULT 50 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissions" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"org_id" text NOT NULL,
	"rule_id" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gross_amount" integer NOT NULL,
	"partner_amount" integer NOT NULL,
	"partner_amount_inr" integer,
	"status" "commission_status" DEFAULT 'EXPECTED' NOT NULL,
	"invoice_ref" text,
	"invoiced_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commissions_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"amount_inr" integer NOT NULL,
	"status" "payout_status" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_id" text NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"reference" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" "wallet_entry_kind" NOT NULL,
	"amount_inr" integer NOT NULL,
	"commission_id" text,
	"payout_id" text,
	"reference" text,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_commission_id_commissions_id_fk" FOREIGN KEY ("commission_id") REFERENCES "public"."commissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_rules_scope_idx" ON "commission_rules" USING btree ("university_id","program_id");--> statement-breakpoint
CREATE INDEX "commissions_org_idx" ON "commissions" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "payout_requests_org_idx" ON "payout_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "wallet_entries_org_idx" ON "wallet_entries" USING btree ("org_id","created_at");