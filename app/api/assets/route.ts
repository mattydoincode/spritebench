import { NextResponse } from "next/server";
import { currentUserId } from "@/db/repo/users";
import { listAssets } from "@/db/repo/assets";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ assets: await listAssets(userId) });
}
