ALTER TABLE "app_settings" ALTER COLUMN "brand_color" SET DEFAULT '#c01f53';--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "accent_color" SET DEFAULT '#f7ec22';--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "deep_color" text DEFAULT '#631a33' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "info_color" text DEFAULT '#0466af' NOT NULL;--> statement-breakpoint
-- Move an existing install onto the official Medcity Study Abroad palette,
-- unless somebody has already set colours of their own.
UPDATE "app_settings" SET "brand_color" = '#c01f53' WHERE lower("brand_color") = '#be1049';--> statement-breakpoint
UPDATE "app_settings" SET "accent_color" = '#f7ec22' WHERE lower("accent_color") = '#f5c518';
