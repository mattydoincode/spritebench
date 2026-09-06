import { and, eq } from "drizzle-orm";
import { hasEncryptionKey } from "@/server/config";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { db } from "../index";
import { providerKeys } from "../schema";

export interface ProviderKeyStatus {
  provider: string;
  /** Last four characters only. The key itself never leaves the server. */
  keySuffix: string;
  valid: boolean | null;
  validatedAt: string | null;
  /** True when the key comes from the environment rather than the database. */
  fromEnvironment: boolean;
}

/** Environment fallbacks, so local development needs no database write. */
const ENV_FALLBACKS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY", "OPEN_AI_API_KEY", "OPENAI_APIKEY"]
};

function fromEnvironment(provider: string): string | null {
  for (const name of ENV_FALLBACKS[provider] ?? []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Resolves the key to call a provider with: the user's stored key first, then
 * the environment. Bring-your-own-key is the product, so a missing key is a
 * normal, user-facing condition rather than a server misconfiguration.
 */
export async function resolveProviderKey(
  userId: string,
  provider: string
): Promise<string | null> {
  if (hasEncryptionKey()) {
    const [row] = await db()
      .select({ encryptedKey: providerKeys.encryptedKey })
      .from(providerKeys)
      .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)))
      .limit(1);

    if (row) {
      try {
        return decryptSecret(row.encryptedKey);
      } catch (error) {
        console.error(`[keys] could not decrypt ${provider} key for ${userId}`, error);
      }
    }
  }

  return fromEnvironment(provider);
}

export async function listProviderKeys(userId: string): Promise<ProviderKeyStatus[]> {
  const stored = hasEncryptionKey()
    ? await db()
        .select()
        .from(providerKeys)
        .where(eq(providerKeys.userId, userId))
    : [];

  const statuses: ProviderKeyStatus[] = stored.map((row) => ({
    provider: row.provider,
    keySuffix: row.keySuffix,
    valid: row.valid,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    fromEnvironment: false
  }));

  const covered = new Set(statuses.map((status) => status.provider));

  for (const provider of Object.keys(ENV_FALLBACKS)) {
    if (covered.has(provider)) continue;

    const value = fromEnvironment(provider);
    if (!value) continue;

    statuses.push({
      provider,
      keySuffix: maskSecret(value),
      valid: null,
      validatedAt: null,
      fromEnvironment: true
    });
  }

  return statuses.sort((a, b) => a.provider.localeCompare(b.provider));
}

export async function saveProviderKey(
  userId: string,
  provider: string,
  plaintext: string
): Promise<ProviderKeyStatus> {
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) throw new Error("key is empty");

  const [row] = await db()
    .insert(providerKeys)
    .values({
      userId,
      provider,
      encryptedKey: encryptSecret(trimmed),
      keySuffix: maskSecret(trimmed),
      valid: null,
      validatedAt: null
    })
    .onConflictDoUpdate({
      target: [providerKeys.userId, providerKeys.provider],
      set: {
        encryptedKey: encryptSecret(trimmed),
        keySuffix: maskSecret(trimmed),
        valid: null,
        validatedAt: null,
        updatedAt: new Date()
      }
    })
    .returning();

  return {
    provider: row.provider,
    keySuffix: row.keySuffix,
    valid: row.valid,
    validatedAt: row.validatedAt?.toISOString() ?? null,
    fromEnvironment: false
  };
}

export async function recordKeyValidation(
  userId: string,
  provider: string,
  valid: boolean
): Promise<void> {
  await db()
    .update(providerKeys)
    .set({ valid, validatedAt: new Date() })
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)));
}

export async function deleteProviderKey(userId: string, provider: string): Promise<void> {
  await db()
    .delete(providerKeys)
    .where(and(eq(providerKeys.userId, userId), eq(providerKeys.provider, provider)));
}
