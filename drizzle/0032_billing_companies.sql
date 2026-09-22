CREATE TABLE "billing_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"address" text NOT NULL,
	"state" text NOT NULL,
	"pan" text NOT NULL,
	"gstin" text,
	"lut_number" text,
	"lut_valid_until" date,
	"bank_account_name" text NOT NULL,
	"bank_account_number" text NOT NULL,
	"ifsc" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "counsellors_see_commission" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payout_requests" ADD COLUMN "billing_company_id" text;--> statement-breakpoint
ALTER TABLE "billing_companies" ADD CONSTRAINT "billing_companies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_companies_org_idx" ON "billing_companies" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_billing_company_id_billing_companies_id_fk" FOREIGN KEY ("billing_company_id") REFERENCES "public"."billing_companies"("id") ON DELETE no action ON UPDATE no action;