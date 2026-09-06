import { NextResponse } from "next/server";
import { buildAlphaVisualization } from "@/core/mask";
import { currentUserId } from "@/db/repo/users";
import { decodePng, encodePng } from "@/server/png";
import { loadTemplate } from "@/server/templates";
import { asBytes } from "@/storage/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  const alpha = url.searchParams.get("alpha") === "true";

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const bytes = await loadTemplate(await currentUserId(), file);
  if (!bytes) return NextResponse.json({ error: "template not found" }, { status: 404 });

  const payload = alpha
    ? asBytes(encodePng(buildAlphaVisualization(decodePng(Buffer.from(bytes)))))
    : bytes;

  return new NextResponse(payload, {
    headers: {
      "Content-Type": "image/png",
      // Keyed by filename and rewritten on re-upload, so revalidate.
      "Cache-Control": "no-cache"
    }
  });
}
