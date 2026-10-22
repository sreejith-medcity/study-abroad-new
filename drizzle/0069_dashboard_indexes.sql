CREATE INDEX "applications_student_idx" ON "applications" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "status_history_application_idx" ON "status_history" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE INDEX "students_assigned_idx" ON "students" USING btree ("assigned_to_id");