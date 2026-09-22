ALTER TABLE "enquiries" ADD COLUMN "answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "portal_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "portal_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "portal_logo_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "portal_logo_mime_type" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "student_whatsapp_milestones" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "student_whatsapp_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signup_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;