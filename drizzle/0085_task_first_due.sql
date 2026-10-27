ALTER TABLE "tasks" ADD COLUMN "first_due_on" date;--> statement-breakpoint
CREATE INDEX "enquiries_student_idx" ON "enquiries" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "enquiries_assigned_idx" ON "enquiries" USING btree ("assigned_to_id");--> statement-breakpoint
-- Tasks made before this was kept: the day they are due now is the best record
-- of the day they were first due.
UPDATE "tasks" SET "first_due_on" = "due_on" WHERE "first_due_on" IS NULL;
--> statement-breakpoint
-- The day a task was first due is set as it is made, whichever path made it,
-- and never moved after: pushing or re-dating a task moves due_on only.
CREATE OR REPLACE FUNCTION tasks_first_due_on() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.first_due_on := COALESCE(NEW.first_due_on, NEW.due_on);
  ELSE
    NEW.first_due_on := OLD.first_due_on;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tasks_first_due_on ON "tasks";
--> statement-breakpoint
CREATE TRIGGER tasks_first_due_on BEFORE INSERT OR UPDATE OF first_due_on ON "tasks" FOR EACH ROW EXECUTE FUNCTION tasks_first_due_on();
