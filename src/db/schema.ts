import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { ProcessingSettings } from "@/core/settings";
import type { Size } from "@/core/types";
import type {
  Composition,
  GenerationParams,
  JobStatus,
  PromptSpec,
  TemplateSpec,
  TokenUsage
} from "@/shared/model";

/**
 * Every user-owned row carries `user_id`. Auth does not exist yet and the app
 * runs as a single seeded user, but carrying the column from the start is
 * nearly free and retrofitting it is not.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [uniqueIndex("users_email_key").on(table.email)]);

/**
 * Per-user preferences. Deliberately excludes `concurrency`, which was mixed
 * into the old StudioSettings blob but is server configuration -- one user
 * changing it would otherwise rewrite it for everyone.
 */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  promptPrefix: text("prompt_prefix").notNull().default(""),
  promptSuffix: text("prompt_suffix").notNull().default(""),
  assetSlug: text("asset_slug").notNull().default("prop"),
  generation: jsonb("generation").$type<GenerationParams>().notNull(),
  processing: jsonb("processing").$type<ProcessingSettings>().notNull(),
  activeCompositionId: uuid("active_composition_id"),
  cutTemplateBackgroundOnPaste: boolean("cut_template_background_on_paste")
    .notNull()
    .default(true),
  templateCutTolerance: real("template_cut_tolerance").notNull().default(0.28),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Bring-your-own-key credentials, encrypted at rest with AES-256-GCM under
 * ENCRYPTION_KEY. The plaintext is never returned to the client; the UI only
 * ever sees `keySuffix` and `valid`.
 */
export const providerKeys = pgTable("provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  keySuffix: text("key_suffix").notNull(),
  valid: boolean("valid"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("provider_keys_user_provider_key").on(table.userId, table.provider)
]);

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  folder: text("folder").notNull().default(""),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),

  /** Object storage key for the full-resolution source. Cleared on roll-off. */
  sourceKey: text("source_key"),
  /** Small preview, kept even after the source has been rolled off. */
  thumbKey: text("thumb_key"),
  sourceWidth: integer("source_width").notNull(),
  sourceHeight: integer("source_height").notNull(),
  byteSize: integer("byte_size").notNull().default(0),

  prompt: jsonb("prompt").$type<PromptSpec>().notNull(),
  composedPrompt: text("composed_prompt").notNull().default(""),
  generation: jsonb("generation").$type<GenerationParams>().notNull(),
  processing: jsonb("processing").$type<ProcessingSettings>().notNull(),
  processingDescription: text("processing_description").notNull().default(""),

  exportKey: text("export_key"),
  exportName: text("export_name"),

  rerunOf: uuid("rerun_of"),
  jobId: uuid("job_id"),
  template: jsonb("template").$type<TemplateSpec | null>(),
  usage: jsonb("usage").$type<TokenUsage | null>(),
  elapsedSeconds: real("elapsed_seconds"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the full-resolution source becomes eligible for deletion. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [
  index("assets_user_created_idx").on(table.userId, table.createdAt),
  index("assets_expiry_idx").on(table.expiresAt),
  index("assets_job_idx").on(table.jobId)
]);

export const compositions = pgTable("compositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** The whole Composition document. Only ever read and written as a unit. */
  doc: jsonb("doc").$type<Composition>().notNull(),
  /** Incremented on every write; clients send it back to detect a clobber. */
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [index("compositions_user_idx").on(table.userId, table.updatedAt)]);

/**
 * The domain job record the UI lists and renders. pg-boss keeps its own tables
 * for the work item; this is the thing users see.
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  label: text("label").notNull().default("untitled"),

  batchId: uuid("batch_id"),
  batchIndex: integer("batch_index").notNull().default(1),
  batchSize: integer("batch_size").notNull().default(1),

  prompt: jsonb("prompt").$type<PromptSpec>().notNull(),
  composedPrompt: text("composed_prompt").notNull().default(""),
  generation: jsonb("generation").$type<GenerationParams>().notNull(),
  processing: jsonb("processing").$type<ProcessingSettings>().notNull(),
  folder: text("folder").notNull().default(""),
  template: jsonb("template").$type<TemplateSpec | null>(),
  rerunOf: uuid("rerun_of"),

  assetIds: jsonb("asset_ids").$type<string[]>().notNull().default([]),
  resolvedSize: jsonb("resolved_size").$type<Size | null>(),
  error: text("error"),

  /** Set once the work item is handed to pg-boss. */
  queueJobId: text("queue_job_id"),
  /** Guards against a retry re-running a generation that already succeeded. */
  providerCallCompletedAt: timestamp("provider_call_completed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true })
}, (table) => [
  index("jobs_user_created_idx").on(table.userId, table.createdAt),
  index("jobs_status_idx").on(table.status)
]);

export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Stable identifier as far as the client is concerned. */
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("templates_user_filename_key").on(table.userId, table.filename)
]);

export const palettes = pgTable("palettes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  /** Parsed once on upload so the pipeline never re-parses a palette file. */
  colors: jsonb("colors").$type<Array<{ r: number; g: number; b: number }>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("palettes_user_filename_key").on(table.userId, table.filename)
]);

/** One row per provider call. Written even while everything is free. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  jobId: uuid("job_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  operation: text("operation").notNull(),
  images: integer("images").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  elapsedSeconds: real("elapsed_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("usage_events_user_created_idx").on(table.userId, table.createdAt)]);

export type UserRow = typeof users.$inferSelect;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type ProviderKeyRow = typeof providerKeys.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type CompositionRow = typeof compositions.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type PaletteRow = typeof palettes.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
