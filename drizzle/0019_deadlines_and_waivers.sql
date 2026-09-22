CREATE TABLE "program_deadlines" (
	"id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"intake_month" integer NOT NULL,
	"intake_year" integer NOT NULL,
	"deadline" date NOT NULL,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "fee_waiver" text;--> statement-breakpoint
ALTER TABLE "program_deadlines" ADD CONSTRAINT "program_deadlines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_deadlines" ADD CONSTRAINT "program_deadlines_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_deadlines_intake_uq" ON "program_deadlines" USING btree ("program_id","intake_year","intake_month");--> statement-breakpoint
CREATE INDEX "program_deadlines_deadline_idx" ON "program_deadlines" USING btree ("deadline");