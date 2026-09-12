import { and, asc, eq } from "drizzle-orm";
import { allowEnvProviderKey, hasEncryptionKey } from "@/server/config";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { db } from "../index";
import { projects, providerKeys } from "../schema";

export interface ProviderKeyStatus {
  id: string;
  provider: string;
  /** What the user called it. Blank until they name it. */
  label: string;
  /** Last four characters only. The key itself never leaves the server. */
  keySuffix: string;
  valid: boolean | null;
  validatedAt: string | null;
}

/** Environment fallbacks, gated by ALLOW_ENV_PROVIDER_KEY. */
const ENV_FALLBACKS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPENAI_APIKEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]
};

/**
 * A key from the environment.
 *
 * Off unless `ALLOW_ENV_PROVIDER_KEY` says otherwise, because the fallback
 * that is convenient on one machine becomes an open tab on the operator's
 * account the moment strangers can sign in: every user with no key of their
 * own would generate on it.
 */
function fromEnvironment(provider: string): string | null {
  if (!allowEnvProviderKey()) return null;

  for (const name of ENV_FALLBACKS[provider] ?? []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return null;
}

export class KeyNotUsableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyNotUsableError";
  }
}

/**
 * The plaintext key a job bills, looked up by the id recorded on the job row.
 *
 * The id was validated against the project owner at enqueue, so this does not
 * re-authorize -- it decrypts. A null id means the job was enqueued on the
 * environment fallback.
 */
export async function keyForJob(
  providerKeyId: string | null,
  provider: string
): Promise<string | null> {
  if (providerKeyId && hasEncryptionKey()) {
    const [row] = await db()
      .select({ encryptedKey: providerKeys.encryptedKey })
      .from(providerKeys)
      .where(eq(providerKeys.id, providerKeyId))
      .limit(1);

    if (row) {
      try {
        return decryptSecret(row.encryptedKey);
      } catch (error) {
        console.error(`[keys] could not decrypt ${provider} key ${providerKeyId}`, error);
      }
    }
  }

  return fromEnvironment(provider);
}

/**
 * The keys a project can bill: the owner's, for the provider asked about.
 *
 * Readable by any member who may generate, not just the owner, because that is
 * the dropdown they pick from. Only the label and the last four characters go
 * out -- enough to tell two keys apart, not enough to use one anywhere else.
 */
export async function listProjectKeyOptions(
  projectId: string,
  provider?: string
): Promise<ProviderKeyStatus[]> {
  if (!hasEncryptionKey()) return [];

  const rows = await db()
    .select({ key: providerKeys })
    .from(providerKeys)
    .innerJoin(projects, eq(projects.ownerUserId, providerKeys.userId))
    .where(
      provider
        ? and(eq(projects.id, projectId), eq(providerKeys.provider, provider))
        : eq(projects.id, projectId)
    )
    .orderBy(asc(providerKeys.provider), asc(providerKeys.createdAt));

  return rows.map((row) => toStatus(row.key));
}

/**
 * Resolves what the caller picked into the key id to record on the job.
 *
 * This is the authorization boundary for spending: the id arrives from a
 * dropdown in the browser, and the only thing that makes it legitimate is
 * belonging to this project's current owner and this provider. Checked here so
 * every enqueue path goes through it.
 *
 * An unusable selection is an error rather than a silent fallback -- billing
 * the wrong key is worse than refusing.
 */
export async function resolveKeySelection(
  projectId: string,
  provider: string,
  providerKeyId: string | null | undefined
): Promise<string | null> {
  const options = await listProjectKeyOptions(projectId, provider);

  if (providerKeyId) {
    if (!options.some((option) => option.id === providerKeyId)) {
      throw new KeyNotUsableError(
        `that ${provider} key is not one this project can bill. Pick another.`
      );
    }

    return providerKeyId;
  }

  // No explicit pick. One available key is unambiguous, so use it rather than
  // making a single-choice dropdown mandatory.
  if (options.length === 1) return options[0].id;

  if (options.length > 1) {
    throw new KeyNotUsableError(`choose which ${provider} key to bill`);
  }

  if (fromEnvironment(provider) !== null) return null;

  throw new KeyNotUsableError(
    `this project has no ${provider} key. The owner can add one in settings.`
  );
}

function toStatus(row: typeof providerKeys.$inferSelect): ProviderKeyStatus {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    keySuffix: row.keySuffix,
    valid: row.valid,
    validatedAt: row.validatedAt?.toISOString() ?? null
  };
}

/** Every key the user owns. Offered as a dropdown on projects they own. */
export async function listProviderKeys(userId: string): Promise<ProviderKeyStatus[]> {
  if (!hasEncryptionKey()) return [];

  const rows = await db()
    .select()
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId))
    .orderBy(asc(providerKeys.provider), asc(providerKeys.createdAt));

  return rows.map(toStatus);
}

/**
 * Adds a key. Never an upsert: a user may hold several keys per provider, so
 * saving a second OpenAI key means two keys, not a replacement.
 */
export async function addProviderKey(
  userId: string,
  provider: string,
  label: string,
  plaintext: string
): Promise<ProviderKeyStatus> {
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) throw new Error("key is empty");

  const [row] = await db()
    .insert(providerKeys)
    .values({
      userId,
      provider,
      label: label.trim(),
      encryptedKey: encryptSecret(trimmed),
      keySuffix: maskSecret(trimmed),
      valid: null,
      validatedAt: null
    })
    .returning();

  return toStatus(row);
}

export async function recordKeyValidation(id: string, valid: boolean): Promise<void> {
  await db()
    .update(providerKeys)
    .set({ valid, validatedAt: new Date() })
    .where(eq(providerKeys.id, id));
}

export async function deleteProviderKey(userId: string, id: string): Promise<void> {
  await db()
    .delete(providerKeys)
    .where(and(eq(providerKeys.id, id), eq(providerKeys.userId, userId)));
}

