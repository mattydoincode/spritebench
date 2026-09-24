import type { NextRequest } from "next/server";
import { requireMember, type Capability, type Membership } from "./access";
import { bearerToken } from "./apiToken";
import { UnauthorizedError } from "./errors";
import { requireUser } from "./session";
import { resolveApiToken } from "@/db/repo/apiTokens";

/**
 * Session cookie or Bearer PAT. Used on `/api/v1` and local `/api/storage`
 * (the filesystem driver's signed URLs). Cookie routes stay on `requireUser`
 * so a leaked token cannot mint more tokens or hit generate.
 */
export async function requireV1User(request: Request): Promise<string> {
  const token = bearerToken(request);
  if (token) {
    const userId = await resolveApiToken(token);
    if (!userId) throw new UnauthorizedError("invalid or revoked token");
    return userId;
  }

  return requireUser();
}

export async function v1ProjectContext(
  request: Request,
  params: Promise<{ projectId: string }>,
  capability: Capability = "view"
): Promise<Membership> {
  const userId = await requireV1User(request);
  const { projectId } = await params;
  return requireMember(userId, projectId, capability);
}

export type { NextRequest };
