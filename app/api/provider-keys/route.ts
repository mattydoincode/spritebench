import { NextResponse } from "next/server";
import {
  deleteProviderKey,
  listProviderKeys,
  saveProviderKey
} from "@/db/repo/providerKeys";
import { currentUserId } from "@/db/repo/users";
import { hasEncryptionKey } from "@/server/config";
import { parseBody, providerKeyBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ providerKeys: await listProviderKeys(userId) });
}

export async function PUT(request: Request) {
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

    const body = await parseBody(request, providerKeyBodySchema);
    const userId = await currentUserId();

    const saved = await saveProviderKey(userId, body.provider, body.key);
    return NextResponse.json({ providerKey: saved });
  });
}

export async function DELETE(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "provider required" }, { status: 400 });

  const userId = await currentUserId();
  await deleteProviderKey(userId, provider);

  return NextResponse.json({ providerKeys: await listProviderKeys(userId) });
}
