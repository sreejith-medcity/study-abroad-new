CREATE TYPE "public"."contact_channel" AS ENUM('CALL', 'WHATSAPP', 'VISIT', 'EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."contact_outcome" AS ENUM('REACHED', 'NO_ANSWER', 'WILL_SEND', 'WANTS_TIME', 'NEEDS_COUNSELLING', 'NOT_INTERESTED', 'WRONG_NUMBER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('FOLLOW_UP', 'DOCUMENT', 'APPLICATION', 'CALL', 'VISIT', 'PAYMENT', 'OTHER');--> statement-breakpoint
CREATE TABLE "contact_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"student_id" text NOT NULL,
	"channel" "contact_channel" DEFAULT 'CALL' NOT NULL,
	"inbound" boolean DEFAULT false NOT NULL,
	"outcome" "contact_outcome" NOT NULL,
	"note" text,
	"happened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_id" text,
	"next_action_on" date,
	"next_action_note" text,
	"task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"student_id" text,
	"application_id" text,
	"kind" "task_kind" DEFAULT 'FOLLOW_UP' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"due_on" date NOT NULL,
	"assigned_to_id" text NOT NULL,
	"created_by_id" text,
	"source" text DEFAULT 'by hand' NOT NULL,
	"auto_key" text,
	"done_at" timestamp with time zone,
	"done_by_id" text,
	"done_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_log_student_idx" ON "contact_log" USING btree ("student_id","happened_at");--> statement-breakpoint
CREATE INDEX "tasks_assigned_idx" ON "tasks" USING btree ("assigned_to_id","done_at","due_on");--> statement-breakpoint
CREATE INDEX "tasks_student_idx" ON "tasks" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_auto_key_uq" ON "tasks" USING btree ("auto_key");