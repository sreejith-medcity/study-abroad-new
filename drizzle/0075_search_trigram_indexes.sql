CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "programs_name_trgm" ON "programs" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "programs_study_area_trgm" ON "programs" USING gin ("study_area" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "programs_campus_trgm" ON "programs" USING gin ("campus" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "universities_name_trgm" ON "universities" USING gin ("name" gin_trgm_ops);