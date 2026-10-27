CREATE TYPE "public"."fee_instalment_state" AS ENUM('SCHEDULED', 'INVOICED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."fee_invoice_state" AS ENUM('DRAFT', 'ISSUED', 'PART_PAID', 'PAID', 'CANCELLED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."fee_method" AS ENUM('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'RAZORPAY');--> statement-breakpoint
CREATE TYPE "public"."fee_refund_state" AS ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'PAID');--> statement-breakpoint
CREATE TABLE "fee_instalments" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text,
	"plan_name" text NOT NULL,
	"seq" integer NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gst_percent" real,
	"due_on" date,
	"step_pathway" text,
	"step_key" text,
	"state" "fee_instalment_state" DEFAULT 'SCHEDULED' NOT NULL,
	"invoice_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_invoice_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"instalment_id" text
);
--> statement-breakpoint
CREATE TABLE "fee_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text,
	"org_id" text NOT NULL,
	"student_id" text NOT NULL,
	"state" "fee_invoice_state" DEFAULT 'DRAFT' NOT NULL,
	"kind" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"issued_on" date,
	"due_on" date,
	"seller_name" text,
	"seller_gstin" text,
	"seller_state" text,
	"seller_address" text,
	"place_of_supply" text,
	"gst_percent" real,
	"taxable" integer DEFAULT 0 NOT NULL,
	"cgst" integer,
	"sgst" integer,
	"igst" integer,
	"total" integer,
	"received" integer DEFAULT 0 NOT NULL,
	"refunded" integer DEFAULT 0 NOT NULL,
	"note" text,
	"closed_reason" text,
	"closed_by_id" text,
	"closed_at" timestamp with time zone,
	"created_by_id" text,
	"issued_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"razorpay_link_id" text NOT NULL,
	"url" text NOT NULL,
	"amount" integer NOT NULL,
	"state" text DEFAULT 'CREATED' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fee_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"gst_percent" real,
	"items" jsonb NOT NULL,
	"starter_key" text,
	"source" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"updated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_plans_starter_key_unique" UNIQUE("starter_key")
);
--> statement-breakpoint
CREATE TABLE "fee_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"invoice_id" text NOT NULL,
	"student_id" text NOT NULL,
	"org_id" text NOT NULL,
	"amount" integer NOT NULL,
	"method" "fee_method" NOT NULL,
	"reference" text,
	"received_on" date NOT NULL,
	"razorpay_payment_id" text,
	"note" text,
	"recorded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"invoice_id" text NOT NULL,
	"student_id" text NOT NULL,
	"org_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"state" "fee_refund_state" DEFAULT 'REQUESTED' NOT NULL,
	"requested_by_id" text NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"payout_method" "fee_method",
	"payout_reference" text,
	"paid_by_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_plan_id_fee_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."fee_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_instalments" ADD CONSTRAINT "fee_instalments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoice_lines" ADD CONSTRAINT "fee_invoice_lines_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_invoices" ADD CONSTRAINT "fee_invoices_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_links" ADD CONSTRAINT "fee_payment_links_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payment_links" ADD CONSTRAINT "fee_payment_links_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_plans" ADD CONSTRAINT "fee_plans_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_invoice_id_fee_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fee_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_paid_by_id_users_id_fk" FOREIGN KEY ("paid_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fee_instalments_student_idx" ON "fee_instalments" USING btree ("student_id","seq");--> statement-breakpoint
CREATE INDEX "fee_instalments_step_idx" ON "fee_instalments" USING btree ("state","step_pathway");--> statement-breakpoint
CREATE INDEX "fee_invoice_lines_invoice_idx" ON "fee_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_invoices_number_uq" ON "fee_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "fee_invoices_student_idx" ON "fee_invoices" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "fee_invoices_org_idx" ON "fee_invoices" USING btree ("org_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payment_links_rzp_uq" ON "fee_payment_links" USING btree ("razorpay_link_id");--> statement-breakpoint
CREATE INDEX "fee_payment_links_invoice_idx" ON "fee_payment_links" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_number_uq" ON "fee_receipts" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_receipts_razorpay_uq" ON "fee_receipts" USING btree ("razorpay_payment_id");--> statement-breakpoint
CREATE INDEX "fee_receipts_invoice_idx" ON "fee_receipts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_receipts_day_idx" ON "fee_receipts" USING btree ("org_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_refunds_number_uq" ON "fee_refunds" USING btree ("number");--> statement-breakpoint
CREATE INDEX "fee_refunds_invoice_idx" ON "fee_refunds" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fee_refunds_state_idx" ON "fee_refunds" USING btree ("state");
--> statement-breakpoint
-- The starter fee plans from Medcity's fee sheets (src/lib/fee-plan-starters.ts), put in once by their key.
INSERT INTO "fee_plans" ("id", "starter_key", "name", "note", "currency", "gst_percent", "items", "source") VALUES
  ('starter-fsj-bfd', 'fsj-bfd', 'FSJ and BFD, Germany', 'Airfare not included.', 'INR', 18, '[{"label":"Registration","amount":10000,"share":null,"due":"ON_APPLY"},{"label":"Application","amount":200000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"APPLICATION"},{"label":"After Receiving Offer Letter","amount":200000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"OFFER"},{"label":"Before Visa Submission","amount":90000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"VISA"}]', 'Registration: ₹10,000 + 18% GST. Application: ₹2,00,000 + 18% GST. After Receiving Offer Letter: ₹2,00,000 + 18% GST. Before Visa Submission: ₹90,000 + 18% GST. Total: ₹5,00,000 + 18% GST.'),
  ('starter-nursing-assistant-germany', 'nursing-assistant-germany', 'Nursing Assistant Program, Germany', 'Airfare not included.', 'INR', 18, '[{"label":"Registration","amount":10000,"share":null,"due":"ON_APPLY"},{"label":"Application","amount":200000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"APPLICATION"},{"label":"After Receiving Offer Letter","amount":200000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"OFFER"},{"label":"Before Visa Submission","amount":90000,"share":null,"due":"STEP","pathway":"JOURNEY","stepKey":"VISA"}]', 'Registration: ₹10,000 + 18% GST. Application: ₹2,00,000 + 18% GST. After Receiving Offer Letter: ₹2,00,000 + 18% GST. Before Visa Submission: ₹90,000 + 18% GST. Total: ₹5,00,000 + 18% GST (4 instalments).'),
  ('starter-ausbildung-general-b1-full-b2-part', 'ausbildung-general-b1-full-b2-part', 'Ausbildung Program (General), for B1 Full/B2 Part', 'Refund policy: if candidate withdraws after B2 completion, course fee is deducted and balance refunded. If Medcity fails to secure Ausbildung admission within 1 year of B2 completion, full fee refunded.', 'INR', 18, '[{"label":"Registration","amount":10000,"share":null,"due":"ON_APPLY"},{"label":"Application","amount":200000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"9"},{"label":"After offer letter","amount":200000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"11"},{"label":"Before visa submission","amount":90000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"12"}]', 'For B1 Full/B2 Part, Registration: ₹10,000 + 18% GST. For B1 Full/B2 Part, Application: ₹2,00,000 + 18% GST. For B1 Full/B2 Part, After offer letter: ₹2,00,000 + 18% GST. For B1 Full/B2 Part, Before visa submission: ₹90,000 + 18% GST. Total: B1/B2 Part ₹5,00,000 + GST.'),
  ('starter-ausbildung-general-b2-full', 'ausbildung-general-b2-full', 'Ausbildung Program (General), for B2 Full', 'Refund policy: if candidate withdraws after B2 completion, course fee is deducted and balance refunded. If Medcity fails to secure Ausbildung admission within 1 year of B2 completion, full fee refunded.', 'INR', 18, '[{"label":"Registration","amount":10000,"share":null,"due":"ON_APPLY"},{"label":"Application","amount":200000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"9"},{"label":"After offer letter","amount":200000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"11"},{"label":"Before visa submission","amount":40000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"12"}]', 'For B2 Full, Registration: ₹10,000 + 18% GST. For B2 Full, Application: ₹2,00,000 + 18% GST. For B2 Full, After offer letter: ₹2,00,000 + 18% GST. For B2 Full, Before visa submission: ₹40,000 + 18% GST. Total: B2 Full ₹4,50,000 + GST.'),
  ('starter-ausbildung-nursing-without-interview', 'ausbildung-nursing-without-interview', 'Ausbildung Nursing (Without Interview)', NULL, 'INR', 18, '[{"label":"Registration","amount":10000,"share":null,"due":"ON_APPLY"},{"label":"Application","amount":250000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"9"},{"label":"After Receiving Offer Letter","amount":250000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"11"},{"label":"Before Visa Submission","amount":190000,"share":null,"due":"STEP","pathway":"AUSBILDUNG","stepKey":"12"}]', 'Registration: ₹10,000 + 18% GST. Application: ₹2,50,000 + 18% GST. After Receiving Offer Letter: ₹2,50,000 + 18% GST. Before Visa Submission: ₹1,90,000 + 18% GST. Total: ₹7,00,000 + GST (4 instalments).'),
  ('starter-nclex-rn-service-medcity', 'nclex-rn-service-medcity', 'NCLEX-RN Registration and Coaching, service charge (Medcity students)', 'The third payment''s sheet line says + GST without a rate, so its rate is not recorded. The sheet''s fees in US dollars (credential evaluation, board of nursing application, exam registration, exam scheduling, visa screen) and the optional Quick Result are not on this plan. No Refund Policy applies.', 'INR', 18, '[{"label":"Service, Initial Payment","amount":25000,"share":null,"due":"ON_APPLY"},{"label":"Service, Second Payment","amount":25000,"share":null,"due":"STEP","pathway":"NCLEX","stepKey":"SECOND_SERVICE_CHARGE"},{"label":"Service, Third (visa screen), Medcity students","amount":10000,"share":null,"due":"STEP","pathway":"NCLEX","stepKey":"VISA_SCREENING","gstPercent":null}]', 'Service, Initial Payment: ₹25,000 + 18% GST. Service, Second Payment: ₹25,000 + 18% GST. Service, Third (visa screen), Medcity students: ₹10,000 + GST.'),
  ('starter-nclex-rn-service-outside', 'nclex-rn-service-outside', 'NCLEX-RN Registration and Coaching, service charge (outside candidates)', 'The third payment''s sheet line says + GST without a rate, so its rate is not recorded. The sheet''s fees in US dollars (credential evaluation, board of nursing application, exam registration, exam scheduling, visa screen) and the optional Quick Result are not on this plan. No Refund Policy applies.', 'INR', 18, '[{"label":"Service, Initial Payment","amount":25000,"share":null,"due":"ON_APPLY"},{"label":"Service, Second Payment","amount":25000,"share":null,"due":"STEP","pathway":"NCLEX","stepKey":"SECOND_SERVICE_CHARGE"},{"label":"Service, Third (visa screen), outside candidates","amount":25000,"share":null,"due":"STEP","pathway":"NCLEX","stepKey":"VISA_SCREENING","gstPercent":null}]', 'Service, Initial Payment: ₹25,000 + 18% GST. Service, Second Payment: ₹25,000 + 18% GST. Service, Third (visa screen), outside candidates: ₹25,000 + GST.')
ON CONFLICT ("starter_key") DO NOTHING;