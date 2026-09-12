import { NextResponse } from "next/server";
import { getAssetRow } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";
import { storage } from "@/storage";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 3600;

type Params = { params: Promise<{ projectId: string; id: string }> };

/**
 * Redirects to a signed URL rather than proxying the bytes, so image traffic
 * never passes through the app. `?variant=thumb` serves the small preview,
 * which the library grid uses instead of downloading full-resolution sources.
 *
 * Membership is what authorizes the read: the project id is in the path and
 * the asset must belong to it, so a shared project's images are readable by
 * its collaborators and by nobody else.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const { id } = await params;
    const wantThumb = new URL(request.url).searchParams.get("variant") === "thumb";

    const asset = await getAssetRow(projectId, id);
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
        // The object a key points at is immutable, but where this route sends
        // you is not: signed URLs expire, a roll-off turns the same request
        // into a 410, and switching STORAGE_DRIVER changes the host. Caching
        // the redirect for longer than a signature lives strands the browser
        // on an address the server has stopped issuing.
        "Cache-Control": "private, max-age=1800"
      }
    });
  });
}
