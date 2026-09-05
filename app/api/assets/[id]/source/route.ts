import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getAsset, serialize } from "@/server/library";
import { paths } from "@/server/paths";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await serialize(() => getAsset(id));

  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  const file = path.join(paths.sources, asset.sourceFile);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: `missing source file ${asset.sourceFile}` }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store"
    }
  });
}
