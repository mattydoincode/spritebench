ALTER TABLE "project_invites" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_invites" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
