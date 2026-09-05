import { NextResponse } from "next/server";
import { readSettings, serialize, writeSettings } from "@/server/library";
import { hasOpenAiApiKey } from "@/server/env";
import type { StudioSettings } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await serialize(() => readSettings());
  return NextResponse.json({ settings, hasApiKey: hasOpenAiApiKey() });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<StudioSettings>;

  const settings = await serialize(() => {
    const current = readSettings();
    return writeSettings({ ...current, ...body });
  });

  return NextResponse.json({ settings });
}
