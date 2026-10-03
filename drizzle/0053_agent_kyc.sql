CREATE TYPE "public"."owner_id_kind" AS ENUM('PAN', 'PASSPORT', 'DRIVING_LICENCE', 'VOTER_ID', 'AADHAAR');--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "company_legal_name" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "company_address" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "company_pan" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "company_registration_no" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "owner_id_kind" "owner_id_kind";--> statement-breakpoint
ALTER TABLE "agent_applications" ADD COLUMN "owner_id_number" text;