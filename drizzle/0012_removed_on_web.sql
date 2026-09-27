ALTER TABLE "engine_slots" ADD COLUMN "removed_on_web" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "engine_collections" ADD COLUMN "removed_on_web" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
