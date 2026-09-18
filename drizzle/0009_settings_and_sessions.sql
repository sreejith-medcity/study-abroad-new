CREATE TABLE "app_settings" (
	"id" text PRIMARY KEY DEFAULT 'app' NOT NULL,
	"portal_name" text DEFAULT 'Medcity Overseas' NOT NULL,
	"organisation_name" text DEFAULT 'Medcity International Overseas Corporation' NOT NULL,
	"brand_color" text DEFAULT '#be1049' NOT NULL,
	"accent_color" text DEFAULT '#f5c518' NOT NULL,
	"sign_in_headline" text DEFAULT 'The workspace behind every Medcity student going abroad.' NOT NULL,
	"sign_in_points" text[] DEFAULT '{}'::text[] NOT NULL,
	"sla_new_days" integer DEFAULT 2 NOT NULL,
	"sla_pending_partner_days" integer DEFAULT 5 NOT NULL,
	"sla_in_progress_days" integer DEFAULT 7 NOT NULL,
	"sla_offer_days" integer DEFAULT 10 NOT NULL,
	"sla_hold_days" integer DEFAULT 60 NOT NULL,
	"tier_targets" jsonb DEFAULT '{"SILVER":10,"GOLD":20,"ELITE":50,"PLATINUM":50}'::jsonb NOT NULL,
	"follow_up_days" integer DEFAULT 1 NOT NULL,
	"enquiry_stale_days" integer DEFAULT 30 NOT NULL,
	"fx_rates" jsonb DEFAULT '{"GBP":112,"EUR":96,"AUD":58,"CAD":62,"USD":88}'::jsonb NOT NULL,
	"support_email" text,
	"support_phone" text,
	"support_hours" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text NOT NULL,
	"outcome" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_in_events_user_idx" ON "sign_in_events" USING btree ("user_id","created_at");