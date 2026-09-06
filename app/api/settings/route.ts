import { NextResponse } from "next/server";
import { listProviderKeys } from "@/db/repo/providerKeys";
import { currentUserId, readSettings, writeSettings } from "@/db/repo/users";
import { parseBody, settingsPatchSchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  const [settings, keys] = await Promise.all([readSettings(userId), listProviderKeys(userId)]);

  return NextResponse.json({
    settings,
    providerKeys: keys,
    // Retained for the existing client, which only checks whether a key exists.
    hasApiKey: keys.some((key) => key.provider === "openai")
  });
}

export async function PUT(request: Request) {
  return withValidation(async () => {
    const body = await parseBody(request, settingsPatchSchema);
    const userId = await currentUserId();

    return NextResponse.json({ settings: await writeSettings(userId, body) });
  });
}
