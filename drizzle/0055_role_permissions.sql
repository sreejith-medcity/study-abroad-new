CREATE TABLE "role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"capability" text NOT NULL,
	"allowed" boolean NOT NULL,
	"set_by_id" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_uq" ON "role_permissions" USING btree ("role","capability");