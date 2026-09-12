import { NextResponse } from "next/server";
import { requireMember } from "@/server/access";
import { requireUser } from "@/server/session";
import { withValidation } from "@/server/validation";
import { ObjectNotFoundError, storage, storageDriver } from "@/storage";

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
 * Every key is `p/{projectId}/...`, so the object's owner is in its path and
 * authorization needs no lookup beyond the membership check itself. A key
 * shaped any other way predates the project prefix and is refused rather than
 * served to whoever asked.
 */
function projectIdOf(key: string): string | null {
  const parts = key.split("/");
  return parts[0] === "p" && parts[1] ? parts[1] : null;
}

/**
 * Serves objects for the local storage driver, which has no object store to
 * hand out signed URLs for. The R2 driver never routes through here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  return withValidation(async () => {
    // Only LocalFsStorage.signedUrl() points at this path, so a request
    // arriving under any other driver is a stale URL -- a cached redirect from
    // a previous STORAGE_DRIVER, say. Reading the object anyway would answer
    // 200 while quietly proxying every image byte through the app.
    if (storageDriver() !== "local") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const { key: segments } = await params;
    const key = segments.map(decodeURIComponent).join("/");

    // Signed URLs are unguessable but not unshareable, and this driver's
    // "signature" is only a path. Checking membership means a leaked dev URL
    // is still useless to someone outside the project.
    const projectId = projectIdOf(key);
    if (!projectId) return NextResponse.json({ error: "not found" }, { status: 404 });

    await requireMember(await requireUser(), projectId, "view");

    try {
      const bytes = await storage().get(key);

      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": contentTypeFor(key),
          // Objects are never rewritten in place; a new version gets a new key.
          "Cache-Control": "private, max-age=31536000, immutable"
        }
      });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ error: "could not read object" }, { status: 400 });
    }
  });
}
