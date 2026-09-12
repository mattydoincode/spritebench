import { NextResponse } from "next/server";
import { listProviderKeys } from "@/db/repo/providerKeys";
import { readSettings, writeSettings } from "@/db/repo/users";
import { requireUser } from "@/server/session";
import { parseBody, settingsPatchSchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

/** Per-user, not per-project: these are one person's working preferences. */
export async function GET() {
  return withValidation(async () => {
    const userId = await requireUser();
    const [settings, providerKeys] = await Promise.all([
      readSettings(userId),
      listProviderKeys(userId)
    ]);

    return NextResponse.json({ settings, providerKeys });
  });
}

export async function PUT(request: Request) {
  return withValidation(async () => {
    const userId = await requireUser();
    const body = await parseBody(request, settingsPatchSchema);

    return NextResponse.json({ settings: await writeSettings(userId, body) });
  });
}
