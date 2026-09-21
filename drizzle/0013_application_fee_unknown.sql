ALTER TABLE "programs" ALTER COLUMN "application_fee" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "programs" ALTER COLUMN "application_fee" DROP NOT NULL;