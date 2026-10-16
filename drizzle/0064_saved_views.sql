CREATE TYPE "public"."view_scope" AS ENUM('STUDENTS', 'APPLICATIONS', 'DOCUMENTATION', 'ENQUIRIES');--> statement-breakpoint
CREATE TYPE "public"."view_shared" AS ENUM('PRIVATE', 'ORG', 'EVERYONE');--> statement-breakpoint
CREATE TABLE "view_pins" (
	"id" text PRIMARY KEY NOT NULL,
	"view_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" "view_scope" NOT NULL,
	"name" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"shared" "view_shared" DEFAULT 'PRIVATE' NOT NULL,
	"owner_id" text NOT NULL,
	"org_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "view_pins" ADD CONSTRAINT "view_pins_view_id_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_pins" ADD CONSTRAINT "view_pins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "view_pins_uq" ON "view_pins" USING btree ("view_id","user_id");--> statement-breakpoint
CREATE INDEX "view_pins_user_idx" ON "view_pins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "views_scope_idx" ON "views" USING btree ("scope","owner_id");--> statement-breakpoint
CREATE INDEX "views_shared_idx" ON "views" USING btree ("scope","shared");