import { NextResponse } from "next/server";
import { readAssets, serialize } from "@/server/library";

export const dynamic = "force-dynamic";

export async function GET() {
  const assets = await serialize(() => readAssets());
  return NextResponse.json({ assets });
}
