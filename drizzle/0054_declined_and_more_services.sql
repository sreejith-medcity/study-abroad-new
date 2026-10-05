ALTER TYPE "public"."service_status" ADD VALUE 'DECLINED';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE 'SIM' BEFORE 'OTHER';--> statement-breakpoint
ALTER TYPE "public"."service_type" ADD VALUE 'PICKUP' BEFORE 'OTHER';