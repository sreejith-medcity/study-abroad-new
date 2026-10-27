CREATE TABLE IF NOT EXISTS "team_pathways" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"pathway" "pathway" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_pathways" ADD CONSTRAINT "team_pathways_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_pathways_uq" ON "team_pathways" USING btree ("team_id","pathway");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_pathways_pathway_idx" ON "team_pathways" USING btree ("pathway");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "students_team_idx" ON "students" USING btree ("team_id");
