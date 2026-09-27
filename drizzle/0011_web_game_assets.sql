ALTER TABLE "engine_slots" ADD COLUMN "origin" text DEFAULT 'godot' NOT NULL;
--> statement-breakpoint
ALTER TABLE "engine_collections" ADD COLUMN "origin" text DEFAULT 'godot' NOT NULL;
--> statement-breakpoint
