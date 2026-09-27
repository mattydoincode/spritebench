ALTER TABLE "engine_slots" ADD COLUMN "final_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "engine_slots" ADD COLUMN "final_remote_hash" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "engine_lane" text DEFAULT 'final' NOT NULL;
--> statement-breakpoint
