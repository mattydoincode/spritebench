import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { ProcessingSettings } from "@/core/settings";
import type { Size } from "@/core/types";
import type {
  GenerationParams,
  JobStatus,
  PromptSpec,
  JobInputs,
  SequencePlan,
  TokenUsage
} from "@/shared/model";

/**
 * Raw bytes. Drizzle ships no `bytea` builtin, and `pg` already maps the type
 * to a Buffer in both directions, so the custom type is only about telling
 * Drizzle the column exists.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  }
});

// ---------------------------------------------------------------------------
// Identity. The shapes of `users`, `accounts`, `sessions` and
// `verificationTokens` are dictated by @auth/drizzle-adapter, not by us.
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [uniqueIndex("users_email_key").on(table.email)]);

export const accounts = pgTable("accounts", {
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state")
}, (table) => [
  primaryKey({ columns: [table.provider, table.providerAccountId] }),
  index("accounts_user_idx").on(table.userId)
]);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull()
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { withTimezone: true }).notNull()
}, (table) => [primaryKey({ columns: [table.identifier, table.token] })]);

/**
 * Per-user preferences. Everything here is one person's UI choice, which is
 * why none of it is in the shared document: two collaborators can hold
 * different prompt prefixes and different generation defaults.
 */
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  generation: jsonb("generation").$type<GenerationParams>().notNull(),
  processing: jsonb("processing").$type<ProcessingSettings>().notNull(),
  cutTemplateBackgroundOnPaste: boolean("cut_template_background_on_paste")
    .notNull()
    .default(true),
  templateCutTolerance: real("template_cut_tolerance").notNull().default(0.28),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

// ---------------------------------------------------------------------------
// Projects. The unit of ownership, sharing, storage prefix, and billing.
// ---------------------------------------------------------------------------

export type ProjectRole = "owner" | "editor" | "viewer";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /**
   * Allocator for per-project asset numbers. Bumped with a single
   * `update ... returning`, so it needs no row lock and never retries.
   * Numbers are never reused: deleting asset 003 leaves a gap rather than
   * handing the number to a different image.
   */
  nextAssetSeq: integer("next_asset_seq").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [index("projects_owner_idx").on(table.ownerUserId)]);

/**
 * Membership is the only thing that grants access to a project's rows. The
 * owner gets a row here too, so authorization never has to special-case them.
 *
 * `canGenerate` is separate from the role because generation spends the
 * owner's money: an editor who can rearrange the scene is not
 * necessarily an editor who can bill you for images.
 */
export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<ProjectRole>().notNull().default("editor"),
  canGenerate: boolean("can_generate").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
  index("project_members_user_idx").on(table.userId)
]);

/**
 * Invites by email address, so a project can be shared with someone who has
 * no account yet. The table ships before the UI does; retrofitting it later
 * would mean another migration for no gain.
 */
export const projectInvites = pgTable("project_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<ProjectRole>().notNull().default("editor"),
  canGenerate: boolean("can_generate").notNull().default(false),
  token: text("token").notNull(),
  invitedByUserId: uuid("invited_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("project_invites_token_key").on(table.token),
  index("project_invites_email_idx").on(table.email)
]);

// ---------------------------------------------------------------------------
// The shared document. One Yjs doc per project, stored as a compacted state
// plus a log of updates the clients have not folded in yet.
// ---------------------------------------------------------------------------

/**
 * The compacted document. `seq` is the high-water mark of the update log that
 * `state` already contains, so a client asking for everything after `seq` gets
 * exactly the updates that are not baked in.
 */
export const projectDocs = pgTable("project_docs", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  state: bytea("state").notNull(),
  seq: integer("seq").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Append-only log of Yjs updates. Clients poll with the last `seq` they saw
 * and get back only what they are missing, which is what makes a no-op poll
 * cost a couple hundred bytes.
 *
 * `actorUserId` is who made the edit. Yjs itself carries no identity, so this
 * is the only place attribution lives.
 */
export const projectDocUpdates = pgTable("project_doc_updates", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  update: bytea("update").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("project_doc_updates_project_seq_idx").on(table.projectId, table.seq)]);

// ---------------------------------------------------------------------------
// Credentials.
// ---------------------------------------------------------------------------

/**
 * Bring-your-own-key credentials, encrypted at rest with AES-256-GCM under
 * ENCRYPTION_KEY. The plaintext is never returned to the client; the UI only
 * ever sees `label`, `keySuffix` and `valid`.
 *
 * A user may hold several keys per provider -- a personal one and a studio
 * one, say -- so there is no unique constraint on (user, provider). Which key
 * a given generation billed is recorded on the job, chosen at enqueue.
 */
export const providerKeys = pgTable("provider_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  label: text("label").notNull().default(""),
  encryptedKey: text("encrypted_key").notNull(),
  keySuffix: text("key_suffix").notNull(),
  valid: boolean("valid"),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("provider_keys_user_idx").on(table.userId, table.provider)]);

// ---------------------------------------------------------------------------
// Project content.
// ---------------------------------------------------------------------------

/**
 * The provenance half of an asset: what the server generated and can prove.
 * Everything a human can edit -- the name, folder, tags, processing settings,
 * crops -- lives in the project's Yjs document instead, which is what makes
 * renaming collaborative and undoable.
 *
 * `seq` is the per-project number the UI shows as `001`. It is a fact, unlike
 * the pretty name, which is an opinion.
 */
export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Who pressed Generate. Null once that user is deleted. */
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null"
  }),
  seq: integer("seq").notNull(),

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
  /** The settings the image was generated under. The editable copy is in Yjs. */
  processing: jsonb("processing").$type<ProcessingSettings>().notNull(),

  /** Where the last approved export landed, if there is one. */
  exportKey: text("export_key"),

  rerunOf: uuid("rerun_of"),
  jobId: uuid("job_id"),
  inputs: jsonb("inputs").$type<JobInputs | null>(),
  sequencePlan: jsonb("sequence_plan").$type<SequencePlan | null>(),
  usage: jsonb("usage").$type<TokenUsage | null>(),
  elapsedSeconds: real("elapsed_seconds"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** When the full-resolution source becomes eligible for deletion. */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [
  uniqueIndex("assets_project_seq_key").on(table.projectId, table.seq),
  index("assets_project_created_idx").on(table.projectId, table.createdAt),
  index("assets_expiry_idx").on(table.expiresAt),
  index("assets_job_idx").on(table.jobId)
]);

/**
 * The domain job record the UI lists and renders. pg-boss keeps its own tables
 * for the work item; this is the thing users see.
 *
 * Carries three ids on purpose: `projectId` is where the images land,
 * `userId` is who pressed the button, and `providerKeyId` is which of the
 * owner's keys paid. All three differ when a collaborator generates.
 *
 * The key is resolved at enqueue rather than in the worker so that billing is
 * decided by what the caller picked, not by what the project happens to point
 * at whenever the job reaches the front of the queue.
 */
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Null only for the ALLOW_ENV_PROVIDER_KEY development path. */
  providerKeyId: uuid("provider_key_id").references(() => providerKeys.id, {
    onDelete: "set null"
  }),
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
  inputs: jsonb("inputs").$type<JobInputs | null>(),
  sequencePlan: jsonb("sequence_plan").$type<SequencePlan | null>(),
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
  index("jobs_project_created_idx").on(table.projectId, table.createdAt),
  index("jobs_status_idx").on(table.status)
]);

/**
 * `filename` is a display label, not an identity -- the storage key is derived
 * from `id`. Two collaborators uploading `hero.png` get two templates, which
 * is why there is no unique constraint on the name.
 */
export const templates = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("templates_project_idx").on(table.projectId)]);

export const palettes = pgTable("palettes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storageKey: text("storage_key").notNull(),
  /** Parsed once on upload so the pipeline never re-parses a palette file. */
  colors: jsonb("colors").$type<Array<{ r: number; g: number; b: number }>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [index("palettes_project_idx").on(table.projectId)]);

/** One row per provider call. Written even while everything is free. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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
}, (table) => [index("usage_events_project_created_idx").on(table.projectId, table.createdAt)]);

export type UserRow = typeof users.$inferSelect;
export type UserSettingsRow = typeof userSettings.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type ProjectInviteRow = typeof projectInvites.$inferSelect;
export type ProjectDocRow = typeof projectDocs.$inferSelect;
export type ProviderKeyRow = typeof providerKeys.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type PaletteRow = typeof palettes.$inferSelect;
export type UsageEventRow = typeof usageEvents.$inferSelect;
