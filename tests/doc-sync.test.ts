import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocSync } from "@/client/doc/sync";
import * as doc from "@/shared/doc";

function binary(state: Uint8Array, seq: number): Response {
  return new Response(state.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Doc-Seq": String(seq)
    }
  });
}

describe("DocSync sequence tracking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not let a POST acknowledgement skip unseen updates", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const initial = Y.encodeStateAsUpdate(new Y.Doc());

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        requests.push({ method, url });

        if (requests.length === 1) return binary(initial, 10);
        if (method === "POST") {
          // Sequence 11 belongs to another client. This client's append was
          // assigned 12, but acknowledging 12 must not mark 11 as received.
          return Response.json({ seq: 12 });
        }
        if (url.endsWith("/doc?since=10")) {
          return new Response(null, {
            status: 204,
            headers: { "X-Doc-Seq": "12" }
          });
        }

        throw new Error(`unexpected request: ${method} ${url}`);
      })
    );

    const sync = new DocSync({
      projectId: "project-1",
      canEdit: true,
      onChange: () => undefined,
      onError: (message) => {
        throw new Error(message);
      }
    });

    await sync.start();
    doc.createScene(sync.doc, "pg", "main");

    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(2250);

    expect(requests).toEqual([
      { method: "GET", url: "/api/projects/project-1/doc" },
      { method: "POST", url: "/api/projects/project-1/doc" },
      { method: "GET", url: "/api/projects/project-1/doc?since=10" }
    ]);

    sync.stop();
  });
});
