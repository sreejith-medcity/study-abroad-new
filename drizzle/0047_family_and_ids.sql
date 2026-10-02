ALTER TYPE "public"."role" ADD VALUE 'PARENT';--> statement-breakpoint
CREATE TABLE "id_counters" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"year" integer NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"user_id" text NOT NULL,
	"relation" text NOT NULL,
	"sees_money" boolean DEFAULT false NOT NULL,
	"added_by_id" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" text,
	"student_told_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "id_code" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "medcity_id" text;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_counters_scope_year_uq" ON "id_counters" USING btree ("scope","year");--> statement-breakpoint
CREATE UNIQUE INDEX "student_guardians_user_uq" ON "student_guardians" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "student_guardians_student_idx" ON "student_guardians" USING btree ("student_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_id_code_unique" UNIQUE("id_code");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_medcity_id_unique" UNIQUE("medcity_id");