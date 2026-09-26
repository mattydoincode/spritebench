import { and, asc, eq } from "drizzle-orm";
import { allowEnvProviderKey, hasEncryptionKey } from "@/server/config";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { chooseBillingKey } from "@/shared/billing";
import { db } from "../index";
import { projects, providerKeys } from "../schema";

export interface ProviderKeyStatus {
  id: string;
  provider: string;
  /** What the user called it. Blank until they name it. */
  label: string;
  /** Last four characters only. The key itself never leaves the server. */
  keySuffix: string;
  /** The owner's default for its provider. */
  isDefault: boolean;
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
 * The key a generation in this project bills for `provider`: the project's
 * pick, else the owner's default, else the only key. See `chooseBillingKey`.
 *
 * This is the authorization boundary for spending. The browser no longer
 * names a key at all; everything here comes from the project and its owner.
 * Several keys and no default is an error rather than a guess.
 */
export async function resolveBillingKey(projectId: string, provider: string): Promise<string | null> {
  const [options, [project]] = await Promise.all([
    listProjectKeyOptions(projectId, provider),
    db().select({ keyDefaults: projects.keyDefaults }).from(projects).where(eq(projects.id, projectId))
  ]);

  const choice = chooseBillingKey(provider, options, project?.keyDefaults ?? {});
  if (choice.ok) return choice.keyId;

  if (choice.reason === "no-default") {
    throw new KeyNotUsableError(
      `this project has several ${provider} keys and no default. Pick one in settings.`
    );
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
    isDefault: row.isDefault,
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

  // The first key for a provider becomes its default, so a second one added
  // later does not leave the account with none.
  const [existing] = await db()
    .select({ id: providerKeys.id })
    .from(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
    .limit(1);

  const [row] = await db()
    .insert(providerKeys)
    .values({
      userId,
      provider,
      label: label.trim(),
      encryptedKey: encryptSecret(trimmed),
      keySuffix: maskSecret(trimmed),
      isDefault: !existing,
      valid: null,
      validatedAt: null
    })
    .returning();

  return toStatus(row);
}

/** Makes `id` the default for its provider, and every other key of that provider not. */
export async function setDefaultProviderKey(userId: string, id: string): Promise<void> {
  await db().transaction(async (tx) => {
    const [key] = await tx
      .select({ provider: providerKeys.provider })
      .from(providerKeys)
      .where(and(eq(providerKeys.id, id), eq(providerKeys.userId, userId)));
    if (!key) throw new KeyNotUsableError("that key does not exist");

    await tx
      .update(providerKeys)
      .set({ isDefault: false })
      .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, key.provider)));
    await tx.update(providerKeys).set({ isDefault: true }).where(eq(providerKeys.id, id));
  });
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

