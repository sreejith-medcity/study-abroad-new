CREATE TYPE "public"."german_module_state" AS ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');--> statement-breakpoint
CREATE TABLE "ausbildung_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"preference_1" text,
	"preference_2" text,
	"preference_3" text,
	"application_submitted_on" date,
	"interview_on" timestamp with time zone,
	"interview_with" text,
	"contract_received_on" date,
	"contract_employer" text,
	"note" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ausbildung_profiles_student_id_unique" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "german_modules" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"level" text NOT NULL,
	"state" "german_module_state" DEFAULT 'NOT_STARTED' NOT NULL,
	"completed_on" date,
	"note" text,
	"updated_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "collects_service_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "countries" ADD COLUMN "service_charge_inr" integer;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD COLUMN "pathway" "pathway";--> statement-breakpoint
ALTER TABLE "ausbildung_profiles" ADD CONSTRAINT "ausbildung_profiles_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ausbildung_profiles" ADD CONSTRAINT "ausbildung_profiles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "german_modules" ADD CONSTRAINT "german_modules_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "german_modules" ADD CONSTRAINT "german_modules_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "german_modules_student_level_uq" ON "german_modules" USING btree ("student_id","level");--> statement-breakpoint
INSERT INTO "document_types" ("code", "label", "label_ml", "uploaded_by", "sort_order") VALUES
  ('MOTIVATION_LETTER', 'Motivation letter (Anschreiben)', 'മോട്ടിവേഷൻ ലെറ്റർ', 'partner', 93),
  ('BIRTH_CERTIFICATE', 'Birth certificate', 'ജനന സർട്ടിഫിക്കറ്റ്', 'partner', 12),
  ('NURSING_DEGREE', 'Nursing degree or diploma certificate (BSc / GNM)', 'നഴ്സിങ് ബിരുദം / ഡിപ്ലോമ സർട്ടിഫിക്കറ്റ്', 'partner', 47),
  ('NURSING_MARKSHEETS', 'Nursing marksheets and transcript', 'നഴ്സിങ് മാർക്ക് ഷീറ്റുകളും ട്രാൻസ്ക്രിപ്റ്റും', 'partner', 48)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
UPDATE "document_requirements" SET "pathway" = 'DEGREE', "updated_at" = now()
WHERE "pathway" IS NULL AND "source" = 'ALWAYS' AND "type_code" IN (
  'DEGREE_MARKSHEETS','DEGREE_CERTIFICATE','TRANSCRIPT','BACKLOG_CERTIFICATE','ENGLISH_TEST','MOI','WORK_EXPERIENCE_LETTER','CV',
  'SOP','LOR','PORTFOLIO','UNIVERSITY_FORM','OFFER_LETTER','OFFER_CONDITION_EVIDENCE','OFFER_ACCEPTANCE','SCHOLARSHIP_LETTER',
  'DEPOSIT_RECEIPT','BANK_TRANSFER_PROOF','LOAN_SANCTION','SPONSOR_AFFIDAVIT','CAS_COE','UNCONDITIONAL_OFFER','FEE_RECEIPT',
  'MEDICAL_REPORT','FINANCIAL_PROOF','BANK_STATEMENT','ITR','BIOMETRICS_RECEIPT','ENROLMENT_CONFIRMATION','TERM_REGISTRATION');
--> statement-breakpoint
UPDATE "document_requirements" SET "pathway" = 'DEGREE', "updated_at" = now()
WHERE "pathway" IS NULL AND "source" = 'DESTINATION' AND "type_code" IN ('APS_CERTIFICATE','CREDIBILITY_STATEMENT','CREDENTIAL_EVALUATION');
--> statement-breakpoint
INSERT INTO "document_requirements" ("id", "stage", "type_code", "source", "pathway", "required", "owed_by", "validity_months", "guidance", "sort_order")
SELECT 'req_' || replace(gen_random_uuid()::text, '-', ''), v.stage::journey_stage, v.type_code, 'ALWAYS'::requirement_source, v.pathway::pathway, v.required, 'STUDENT'::owed_by, v.validity, v.guidance, v.sort
FROM (VALUES
  ('PROFILE', 'GERMAN_CERTIFICATE', 'AUSBILDUNG', true, NULL::integer, 'Goethe, telc or ÖSD. Most places ask for B1; nursing and care usually B2.', 2000),
  ('PROFILE', 'CV', 'AUSBILDUNG', true, NULL::integer, 'In German, in the tabular Lebenslauf form, with a photograph.', 2010),
  ('PROFILE', 'MOTIVATION_LETTER', 'AUSBILDUNG', true, NULL::integer, 'In German, addressed to the employer, one page.', 2020),
  ('PROFILE', 'WORK_EXPERIENCE_LETTER', 'AUSBILDUNG', false, NULL::integer, 'Any work or internship, on letterhead with dates and role.', 2030),
  ('PROFILE', 'BIRTH_CERTIFICATE', 'AUSBILDUNG', false, NULL::integer, 'Where the embassy or the employer asks for it.', 2040),
  ('OFFER', 'TRAINING_CONTRACT', 'AUSBILDUNG', true, NULL::integer, 'Signed by the employer and the student. The visa is applied for on this.', 2050),
  ('PROFILE', 'NURSING_DEGREE', 'NURSING', true, NULL::integer, NULL, 3000),
  ('PROFILE', 'NURSING_MARKSHEETS', 'NURSING', true, NULL::integer, 'Every year of the course, with the theory and clinical hours where the college states them.', 3010),
  ('PROFILE', 'NURSING_LICENSE', 'NURSING', true, NULL::integer, 'The state nursing council registration, current.', 3020),
  ('PROFILE', 'ENGLISH_TEST', 'NURSING', true, 24, 'OET or IELTS academic. Two years from the test date.', 3030),
  ('PROFILE', 'WORK_EXPERIENCE_LETTER', 'NURSING', false, NULL::integer, 'Each hospital, on letterhead, with the dates and the ward.', 3040),
  ('PROFILE', 'CV', 'NURSING', true, NULL::integer, NULL, 3050),
  ('APPLICATION', 'CREDENTIAL_EVALUATION', 'NURSING', true, NULL::integer, 'CGFNS for NCLEX-RN, or the evaluation the board names.', 3060)
) AS v(stage, type_code, pathway, required, validity, guidance, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM "document_requirements" r
  WHERE r."type_code" = v.type_code AND r."source" = 'ALWAYS' AND r."pathway" = v.pathway::pathway
);
