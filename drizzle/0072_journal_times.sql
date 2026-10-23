ALTER TABLE "app_settings" ALTER COLUMN "journal_day_end" SET DEFAULT '17:00';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "journal_cutoff" SET DEFAULT '23:59';--> statement-breakpoint
UPDATE "app_settings" SET "journal_day_end" = '17:00', "journal_cutoff" = '23:59';
