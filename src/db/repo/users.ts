import { eq, sql } from "drizzle-orm";
import { DEFAULT_PROCESSING, withDefaults, type ProcessingSettings } from "@/core/settings";
import {
  DEFAULT_GENERATION,
  type GenerationParams,
  type StudioSettings
} from "@/shared/model";
import { SINGLE_USER_EMAIL, singleUserId } from "@/server/config";
import { db, type Transaction } from "../index";
import { userSettings, users, type UserSettingsRow } from "../schema";

export const DEFAULT_PROMPT_PREFIX =
  "You are generating game art from a 100% top-down perspective. This means we'll only see the tops of objects, never the sides. Schematic like, no perspective, perfectly top down.";

export const DEFAULT_PROMPT_SUFFIX = "Transparent Background";

let cachedUserId: string | null = null;

/**
 * Takes a row lock on the user for the rest of the transaction.
 *
 * Quota checks read a count and then act on it, which is only sound if
 * concurrent requests for the same user take turns. Two tabs pressing Create
 * at once would otherwise both see room for one more batch.
 */
export async function lockUser(userId: string, connection: Transaction): Promise<void> {
  await connection.execute(sql`select 1 from ${users} where ${users.id} = ${userId} for update`);
}

/**
 * Resolves the acting user. Until auth exists this is a single row, created on
 * first use so a fresh database boots without a seed step.
 */
export async function currentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const configured = singleUserId();
  if (configured) {
    cachedUserId = configured;
    await ensureSettings(configured);
    return configured;
  }

  const existing = await db().select({ id: users.id }).from(users).limit(1);
  if (existing.length > 0) {
    cachedUserId = existing[0].id;
    await ensureSettings(cachedUserId);
    return cachedUserId;
  }

  const [created] = await db()
    .insert(users)
    .values({ email: SINGLE_USER_EMAIL, name: "Local" })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (created) {
    cachedUserId = created.id;
  } else {
    const [found] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, SINGLE_USER_EMAIL))
      .limit(1);
    cachedUserId = found.id;
  }

  await ensureSettings(cachedUserId);
  return cachedUserId;
}

export function resetUserCache(): void {
  cachedUserId = null;
}

function toStudioSettings(row: UserSettingsRow): StudioSettings {
  return {
    promptPrefix: row.promptPrefix,
    promptSuffix: row.promptSuffix,
    assetSlug: row.assetSlug,
    generation: { ...DEFAULT_GENERATION, ...(row.generation ?? {}) },
    processing: withDefaults(row.processing),
    activeCompositionId: row.activeCompositionId,
    cutTemplateBackgroundOnPaste: row.cutTemplateBackgroundOnPaste,
    templateCutTolerance: row.templateCutTolerance
  };
}

async function ensureSettings(userId: string): Promise<UserSettingsRow> {
  const [existing] = await db()
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db()
    .insert(userSettings)
    .values({
      userId,
      promptPrefix: DEFAULT_PROMPT_PREFIX,
      promptSuffix: DEFAULT_PROMPT_SUFFIX,
      assetSlug: "prop",
      generation: DEFAULT_GENERATION,
      processing: DEFAULT_PROCESSING
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { updatedAt: new Date() }
    })
    .returning();

  return created;
}

export async function readSettings(userId: string): Promise<StudioSettings> {
  return toStudioSettings(await ensureSettings(userId));
}

/**
 * Nested settings are patched field by field, so a client that only knows
 * about some of them cannot blank out the rest.
 */
export type StudioSettingsPatch = Partial<
  Omit<StudioSettings, "generation" | "processing">
> & {
  generation?: Partial<GenerationParams>;
  processing?: Partial<ProcessingSettings>;
};

export async function writeSettings(
  userId: string,
  patch: StudioSettingsPatch
): Promise<StudioSettings> {
  const current = await readSettings(userId);
  const next: StudioSettings = {
    ...current,
    ...patch,
    generation: { ...current.generation, ...(patch.generation ?? {}) },
    processing: withDefaults({ ...current.processing, ...(patch.processing ?? {}) })
  };

  const [updated] = await db()
    .update(userSettings)
    .set({
      promptPrefix: next.promptPrefix,
      promptSuffix: next.promptSuffix,
      assetSlug: next.assetSlug,
      generation: next.generation,
      processing: next.processing,
      activeCompositionId: next.activeCompositionId,
      cutTemplateBackgroundOnPaste: next.cutTemplateBackgroundOnPaste,
      templateCutTolerance: next.templateCutTolerance,
      updatedAt: new Date()
    })
    .where(eq(userSettings.userId, userId))
    .returning();

  return toStudioSettings(updated);
}
