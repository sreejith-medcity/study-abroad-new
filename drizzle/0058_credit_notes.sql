CREATE TABLE "credit_note_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"credit_note_id" text NOT NULL,
	"invoice_line_id" text NOT NULL,
	"amount" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"invoice_id" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"issued_on" date NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "route_change_reason" text;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_vendor_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."vendor_invoice_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_vendor_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."vendor_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_lines_uq" ON "credit_note_lines" USING btree ("credit_note_id","invoice_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_number_uq" ON "credit_notes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");