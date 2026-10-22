CREATE TABLE "nclex_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"board_state" text,
	"payment_link" text,
	"result" text,
	"result_on" date,
	"note" text,
	"updated_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nclex_cases_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "nclex_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"step" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_on" date,
	"document_id" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nclex_cases" ADD CONSTRAINT "nclex_cases_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nclex_cases" ADD CONSTRAINT "nclex_cases_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nclex_steps" ADD CONSTRAINT "nclex_steps_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nclex_steps" ADD CONSTRAINT "nclex_steps_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nclex_steps" ADD CONSTRAINT "nclex_steps_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nclex_steps_student_step_uq" ON "nclex_steps" USING btree ("student_id","step");