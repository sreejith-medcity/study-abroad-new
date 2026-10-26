ALTER TYPE "public"."enquiry_stage" ADD VALUE 'MERGED';--> statement-breakpoint
CREATE TABLE "enquiry_routing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"org_id" text,
	"source" "enquiry_source",
	"pathway" "pathway",
	"method" text DEFAULT 'ROUND_ROBIN' NOT NULL,
	"assign_to_id" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lost_reasons" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "lost_reason_id" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "lost_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "repeat_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_into_id" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_by_id" text;--> statement-breakpoint
ALTER TABLE "enquiry_routing_rules" ADD CONSTRAINT "enquiry_routing_rules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_routing_rules" ADD CONSTRAINT "enquiry_routing_rules_assign_to_id_users_id_fk" FOREIGN KEY ("assign_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_routing_rules" ADD CONSTRAINT "enquiry_routing_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lost_reasons" ADD CONSTRAINT "lost_reasons_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiry_routing_rules_idx" ON "enquiry_routing_rules" USING btree ("active","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "lost_reasons_label_uq" ON "lost_reasons" USING btree (lower("label"));--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_lost_reason_id_lost_reasons_id_fk" FOREIGN KEY ("lost_reason_id") REFERENCES "public"."lost_reasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_merged_into_id_enquiries_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_merged_by_id_users_id_fk" FOREIGN KEY ("merged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiries_phone_key_idx" ON "enquiries" USING btree (right(regexp_replace("phone", '[^0-9]', '', 'g'), 10));--> statement-breakpoint
CREATE INDEX "enquiries_email_idx" ON "enquiries" USING btree (lower("email"));