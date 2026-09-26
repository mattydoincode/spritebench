ALTER TABLE "provider_keys" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "key_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
-- A lone key per provider is already unambiguous; make it the default so
-- adding a second one later does not suddenly block generation.
UPDATE "provider_keys" SET "is_default" = true
WHERE ("user_id", "provider") IN (
  SELECT "user_id", "provider" FROM "provider_keys" GROUP BY "user_id", "provider" HAVING count(*) = 1
);
--> statement-breakpoint
