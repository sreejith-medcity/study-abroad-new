DROP INDEX "record_versions_time_idx";--> statement-breakpoint
CREATE INDEX "enquiries_merged_into_idx" ON "enquiries" USING btree ("merged_into_id");--> statement-breakpoint
CREATE INDEX "record_versions_feed_idx" ON "record_versions" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "record_versions_entity_feed_idx" ON "record_versions" USING btree ("entity","created_at","id");