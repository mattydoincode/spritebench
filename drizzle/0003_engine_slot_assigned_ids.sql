ALTER TABLE "engine_slots" ADD COLUMN "assigned_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "engine_slots" SET "assigned_asset_ids" = jsonb_build_array("assigned_asset_id") WHERE "assigned_asset_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "engine_slots" DROP CONSTRAINT "engine_slots_assigned_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "engine_slots" DROP COLUMN "assigned_asset_id";
