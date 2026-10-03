CREATE INDEX "audit_action_time_idx" ON "audit_logs" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "checklist_items_decided_idx" ON "checklist_items" USING btree ("decided_at" DESC NULLS LAST) WHERE decided_at is not null;