CREATE TYPE "public"."offer_type" AS ENUM('CONDITIONAL', 'UNCONDITIONAL');--> statement-breakpoint
CREATE TYPE "public"."visa_decision" AS ENUM('GRANTED', 'REFUSED');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_type" "offer_type";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_date" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_conditions" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "offer_accept_by" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deposit_amount" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "deposit_paid_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "confirmation_number" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "confirmation_issued_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "visa_lodged_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "visa_decision" "visa_decision";--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "visa_decision_on" date;