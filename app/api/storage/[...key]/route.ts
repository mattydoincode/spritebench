import { NextResponse } from "next/server";
import { ObjectNotFoundError, storage } from "@/storage";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  json: "application/json",
  txt: "text/plain",
  hex: "text/plain",
  gpl: "text/plain",
  pal: "text/plain"
};

function contentTypeFor(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Serves objects for the local storage driver, which has no object store to
 * hand out signed URLs for. The R2 driver never routes through here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: segments } = await params;
  const key = segments.map(decodeURIComponent).join("/");

  try {
    const bytes = await storage().get(key);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentTypeFor(key),
        // Stored objects are never rewritten in place; a new version gets a new key.
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "could not read object" }, { status: 400 });
  }
}
