import { NextResponse } from "next/server";
import * as Y from "yjs";
import { appendDocUpdate, readDoc, readDocSince } from "@/db/repo/projectDoc";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/** One update is a handful of field writes; anything larger is not a gesture. */
const MAX_UPDATE_BYTES = 1_000_000;

/**
 * Sync for the project's shared document.
 *
 * Deliberately plain HTTP. Yjs updates are order-independent and idempotent,
 * so a client that polls converges on exactly the same document as one on a
 * websocket -- it just learns about changes a second or two later. That keeps
 * the whole feature on the single web instance the app already runs, with no
 * stateful process to route to and nothing to pay for while nobody is
 * editing.
 *
 * Swapping in a websocket later replaces this file and nothing else: the
 * document model, the merge behaviour and undo do not know how bytes arrive.
 */

/**
 * `?since=N` returns only what N is missing, which makes an idle poll a couple
 * hundred bytes. Omitting it returns the whole document, for a cold load.
 *
 * The body is binary rather than JSON because base64 would inflate every
 * update by a third for no benefit.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");

    const raw = new URL(request.url).searchParams.get("since");
    const since = raw === null ? null : Number(raw);

    if (since === null || !Number.isFinite(since) || since < 0) {
      const snapshot = await readDoc(projectId);
      return binary(snapshot.state, snapshot.seq, true);
    }

    const increment = await readDocSince(projectId, since);

    // Nothing new. 204 rather than an empty 200 so the client can skip
    // decoding, and so this shows up as "no change" in a log.
    if (!increment.full && increment.updates.length === 0) {
      return new NextResponse(null, {
        status: 204,
        headers: { "X-Doc-Seq": String(increment.seq) }
      });
    }

    if (increment.full) {
      return binary(increment.state, increment.seq, true);
    }

    const merged =
      increment.updates.length === 1
        ? increment.updates[0]
        : Y.mergeUpdates(increment.updates);

    return binary(merged, increment.seq, false);
  });
}

/**
 * Appends one update. Requires `edit`, so a viewer can follow along but
 * cannot write -- the client hides the controls, and this is what makes that
 * more than a suggestion.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "edit");

    const body = new Uint8Array(await request.arrayBuffer());

    if (body.byteLength === 0) {
      return NextResponse.json({ error: "empty update" }, { status: 400 });
    }
    if (body.byteLength > MAX_UPDATE_BYTES) {
      return NextResponse.json({ error: "update is too large" }, { status: 413 });
    }

    const seq = await appendDocUpdate(projectId, body, userId);

    return NextResponse.json({ seq });
  });
}

function binary(bytes: Uint8Array, seq: number, full: boolean): NextResponse {
  // Copied into its own buffer because a Uint8Array view is not a BodyInit.
  return new NextResponse(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Doc-Seq": String(seq),
      // Tells the client whether it received a whole document or a tail, so a
      // cold load and a catch-up take the same code path.
      "X-Doc-Full": full ? "1" : "0",
      "Cache-Control": "no-store"
    }
  });
}
