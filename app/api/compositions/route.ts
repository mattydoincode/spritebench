import { NextResponse } from "next/server";
import {
  CompositionConflictError,
  deleteComposition,
  listCompositions,
  saveComposition
} from "@/db/repo/compositions";
import { currentUserId } from "@/db/repo/users";
import { compositionSchema, parseBody, withValidation } from "@/server/validation";
import type { Composition } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ compositions: await listCompositions(userId) });
}

export async function PUT(request: Request) {
  return withValidation(async () => {
    const body = await parseBody(request, compositionSchema);
    const userId = await currentUserId();

    // The version the client last saw. Either an `If-Match` header or the
    // `version` field on the document; absent means "I do not know", which
    // skips the check so first-time and scripted writes still work.
    const header = request.headers.get("if-match");
    const expected = header !== null ? Number(header) : (body.version ?? null);

    const doc: Composition = { ...body, updatedAt: new Date().toISOString() };

    try {
      const composition = await saveComposition(
        userId,
        doc,
        expected !== null && Number.isFinite(expected) ? expected : null
      );

      return NextResponse.json({ composition }, { headers: { ETag: String(composition.version) } });
    } catch (error) {
      if (error instanceof CompositionConflictError) {
        return NextResponse.json(
          {
            error: "this composition changed in another tab or device",
            composition: error.current,
            version: error.currentVersion
          },
          { status: 409 }
        );
      }
      throw error;
    }
  });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "composition id required" }, { status: 400 });

  await deleteComposition(await currentUserId(), id);
  return NextResponse.json({ ok: true });
}
