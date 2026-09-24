import { and, desc, eq, isNull } from "drizzle-orm";
import { hashApiToken, mintApiToken } from "@/server/apiToken";
import { db } from "../index";
import { apiTokens } from "../schema";

export interface ApiTokenStatus {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function toStatus(row: {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiTokenStatus {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

export async function listApiTokens(userId: string): Promise<ApiTokenStatus[]> {
  const rows = await db()
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  return rows.map(toStatus);
}

export async function createApiToken(
  userId: string,
  name: string
): Promise<{ token: string; record: ApiTokenStatus }> {
  const minted = mintApiToken();

  const [row] = await db()
    .insert(apiTokens)
    .values({
      userId,
      name,
      hash: minted.hash,
      prefix: minted.prefix
    })
    .returning();

  return { token: minted.token, record: toStatus(row) };
}

export async function revokeApiToken(userId: string, id: string): Promise<boolean> {
  const [row] = await db()
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });

  return Boolean(row);
}

export async function resolveApiToken(token: string): Promise<string | null> {
  const hash = hashApiToken(token);

  const [row] = await db()
    .select({ id: apiTokens.id, userId: apiTokens.userId })
    .from(apiTokens)
    .where(and(eq(apiTokens.hash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);

  if (!row) return null;

  await db()
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id));

  return row.userId;
}
