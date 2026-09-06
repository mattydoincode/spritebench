import { NextResponse } from "next/server";
import { getAssetRow } from "@/db/repo/assets";
import { currentUserId } from "@/db/repo/users";
import { storage, storageDriver } from "@/storage";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Redirects to a signed URL rather than proxying the bytes, so image traffic
 * never passes through the app. `?variant=thumb` serves the small preview,
 * which the library grid uses instead of downloading full-resolution sources.
 *
 * The client and the browser worker both just `fetch()` this and follow the
 * redirect, so neither needed changing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wantThumb = new URL(request.url).searchParams.get("variant") === "thumb";
  const userId = await currentUserId();

  const asset = await getAssetRow(userId, id);
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  const key = wantThumb ? (asset.thumbKey ?? asset.sourceKey) : asset.sourceKey;

  if (!key) {
    return NextResponse.json(
      { error: "this image's full-resolution source has been rolled off" },
      { status: 410 }
    );
  }

  const url = await storage().signedUrl(key, SIGNED_URL_TTL_SECONDS);

  return NextResponse.redirect(new URL(url, request.url), {
    status: 302,
    headers: {
      // Local storage serves immutable objects, so the redirect itself can be
      // cached. Signed R2 URLs expire, so it cannot.
      "Cache-Control":
        storageDriver() === "local" ? "public, max-age=31536000, immutable" : "private, max-age=1800"
    }
  });
}
