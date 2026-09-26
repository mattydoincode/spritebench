CREATE TABLE "engine_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"godot_path" text DEFAULT '' NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'godot' NOT NULL,
	"acked" boolean DEFAULT true NOT NULL,
	"pending" boolean DEFAULT false NOT NULL,
	"removed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engine_slots" ADD COLUMN "record_id" uuid;
--> statement-breakpoint
ALTER TABLE "engine_slots" ADD COLUMN "field_key" text;
--> statement-breakpoint
ALTER TABLE "engine_collections" ADD CONSTRAINT "engine_collections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engine_records" ADD CONSTRAINT "engine_records_collection_id_engine_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."engine_collections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "engine_records" ADD CONSTRAINT "engine_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "engine_collections_project_idx" ON "engine_collections" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "engine_records_collection_idx" ON "engine_records" USING btree ("collection_id");
--> statement-breakpoint
CREATE INDEX "engine_slots_record_idx" ON "engine_slots" USING btree ("record_id");
