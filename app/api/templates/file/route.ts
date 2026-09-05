import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildAlphaVisualization } from "@/core/mask";
import { paths } from "@/server/paths";
import { decodePng, encodePng } from "@/server/png";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  const alpha = url.searchParams.get("alpha") === "true";

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const target = path.join(paths.templates, path.basename(file));
  if (!fs.existsSync(target)) {
    return NextResponse.json({ error: "template not found" }, { status: 404 });
  }

  const bytes = fs.readFileSync(target);
  const payload = alpha
    ? encodePng(buildAlphaVisualization(decodePng(bytes)))
    : bytes;

  return new NextResponse(new Uint8Array(payload), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" }
  });
}
