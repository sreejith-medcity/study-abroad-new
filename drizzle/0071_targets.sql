CREATE TYPE "public"."target_metric" AS ENUM('REGISTRATIONS', 'APPLICATIONS', 'VISAS');--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"org_id" text,
	"user_id" text,
	"month" text NOT NULL,
	"metric" "target_metric" NOT NULL,
	"value" integer NOT NULL,
	"set_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "targets_subject_month_metric_uq" ON "targets" USING btree ("subject","month","metric");--> statement-breakpoint
CREATE INDEX "targets_month_idx" ON "targets" USING btree ("month");