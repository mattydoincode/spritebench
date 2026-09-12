import { NextResponse } from "next/server";
import { addProviderKey, deleteProviderKey, listProviderKeys } from "@/db/repo/providerKeys";
import { hasEncryptionKey } from "@/server/config";
import { requireUser } from "@/server/session";
import { parseBody, providerKeyBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * A user's own provider keys. Not project-scoped: keys belong to people, and
 * a project you own points at one of yours.
 */
export async function GET() {
  return withValidation(async () => {
    const userId = await requireUser();
    return NextResponse.json({ providerKeys: await listProviderKeys(userId) });
  });
}

export async function POST(request: Request) {
  return withValidation(async () => {
    if (!hasEncryptionKey()) {
      return NextResponse.json(
        {
          error:
            "the server cannot store credentials: ENCRYPTION_KEY is not configured. Generate one with `openssl rand -base64 32`."
        },
        { status: 503 }
      );
    }

    const userId = await requireUser();
    const body = await parseBody(request, providerKeyBodySchema);

    // Adds rather than replaces: several keys per provider is the point.
    const providerKey = await addProviderKey(
      userId,
      body.provider,
      body.label ?? "",
      body.key
    );

    return NextResponse.json({ providerKey });
  });
}

export async function DELETE(request: Request) {
  return withValidation(async () => {
    const userId = await requireUser();
    const id = new URL(request.url).searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await deleteProviderKey(userId, id);
    return NextResponse.json({ providerKeys: await listProviderKeys(userId) });
  });
}
