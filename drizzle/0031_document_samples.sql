ALTER TABLE "document_types" ADD COLUMN "guidance" text;--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "sample_file_name" text;--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "sample_storage_key" text;--> statement-breakpoint
ALTER TABLE "document_types" ADD COLUMN "sample_mime_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "shared_with_student" boolean DEFAULT false NOT NULL;