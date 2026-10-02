CREATE TYPE "public"."invoice_state" AS ENUM('DRAFT', 'RAISED', 'SENT', 'PART_PAID', 'PAID', 'DISPUTED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"rupee_amount" integer,
	"rate_used" real,
	"received_on" date NOT NULL,
	"reference" text,
	"note" text,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"income_line_id" text NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"vendor_id" text NOT NULL,
	"billing_company_id" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"rupee_total" integer,
	"rate_used" real,
	"tax_treatment" text,
	"tax_percent" real,
	"tax_amount" integer,
	"state" "invoice_state" DEFAULT 'DRAFT' NOT NULL,
	"raised_on" date,
	"due_on" date,
	"sent_at" timestamp with time zone,
	"sent_by_id" text,
	"sent_to" text,
	"paid_at" timestamp with time zone,
	"received_amount" integer DEFAULT 0 NOT NULL,
	"dispute_reason" text,
	"disputed_at" timestamp with time zone,
	"written_off_reason" text,
	"written_off_by_id" text,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "income_lines" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoice_lines" ADD CONSTRAINT "vendor_invoice_lines_income_line_id_income_lines_id_fk" FOREIGN KEY ("income_line_id") REFERENCES "public"."income_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_billing_company_id_billing_companies_id_fk" FOREIGN KEY ("billing_company_id") REFERENCES "public"."billing_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_written_off_by_id_users_id_fk" FOREIGN KEY ("written_off_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_invoices" ADD CONSTRAINT "vendor_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_invoice_lines_uq" ON "vendor_invoice_lines" USING btree ("invoice_id","income_line_id");--> statement-breakpoint
CREATE INDEX "vendor_invoice_lines_income_idx" ON "vendor_invoice_lines" USING btree ("income_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_invoices_number_uq" ON "vendor_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "vendor_invoices_vendor_idx" ON "vendor_invoices" USING btree ("vendor_id","state");