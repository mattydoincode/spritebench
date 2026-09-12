import { eq } from "drizzle-orm";
import { DEFAULT_PROCESSING, withDefaults, type ProcessingSettings } from "@/core/settings";
import { clampGeneration } from "@/providers/models";
import {
  DEFAULT_GENERATION,
  type GenerationParams,
  type StudioSettings
} from "@/shared/model";
import { db } from "../index";
import { projectMembers, users, userSettings, type UserSettingsRow } from "../schema";
import { createProject } from "./projects";

/**
 * Gives an account the two things the auth adapter knows nothing about:
 * default settings, and somewhere to put images.
 *
 * Takes only a user id, and reads the name itself, because the id has to be
 * the one in our `users` table. The obvious place to call this from is the
 * `signIn` callback, and that is wrong: `signIn` is the authorization gate
 * and runs *before* the adapter writes the row, so the id it carries is the
 * provider's subject rather than ours. Inserting against that fails the
 * foreign key, and Auth.js reports a throwing `signIn` callback as
 * `AccessDenied` -- a permission error for what is really a load-order bug.
 *
 * Idempotent, so both the `createUser` event and a later request can call it
 * without coordinating.
 */
export async function ensureBootstrap(userId: string): Promise<void> {
  await ensureSettings(userId);

  const [membership] = await db()
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId))
    .limit(1);

  if (membership) return;

  const [user] = await db()
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const first = (user?.name ?? "").trim().split(/\s+/)[0];
  await createProject(userId, first ? `${first}'s project` : "My project");
}

function toStudioSettings(row: UserSettingsRow): StudioSettings {
  return {
    generation: clampGeneration({ ...DEFAULT_GENERATION, ...(row.generation ?? {}) }),
    processing: withDefaults(row.processing),
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
    generation: clampGeneration({ ...current.generation, ...(patch.generation ?? {}) }),
    processing: withDefaults({ ...current.processing, ...(patch.processing ?? {}) })
  };

  const [updated] = await db()
    .update(userSettings)
    .set({
      generation: next.generation,
      processing: next.processing,
      cutTemplateBackgroundOnPaste: next.cutTemplateBackgroundOnPaste,
      templateCutTolerance: next.templateCutTolerance,
      updatedAt: new Date()
    })
    .where(eq(userSettings.userId, userId))
    .returning();

  return toStudioSettings(updated);
}
