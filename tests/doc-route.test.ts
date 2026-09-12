import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendDocUpdate: vi.fn(),
  projectContext: vi.fn(),
  readDoc: vi.fn(),
  readDocSince: vi.fn()
}));

vi.mock("@/db/repo/projectDoc", () => ({
  appendDocUpdate: mocks.appendDocUpdate,
  readDoc: mocks.readDoc,
  readDocSince: mocks.readDocSince
}));

vi.mock("@/server/access", () => ({
  projectContext: mocks.projectContext
}));

import { GET } from "../app/api/projects/[projectId]/doc/route";

const context = {
  params: Promise.resolve({ projectId: "00000000-0000-0000-0000-000000000001" })
};

describe("project document route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectContext.mockResolvedValue({
      projectId: "00000000-0000-0000-0000-000000000001",
      userId: "00000000-0000-0000-0000-000000000002"
    });
  });

  it("merges every update in an incremental response into valid Yjs bytes", async () => {
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update: Uint8Array) => updates.push(update));

    const map = source.getMap("item");
    map.set("x", 10);
    map.set("y", 20);

    mocks.readDocSince.mockResolvedValue({ full: false, updates, seq: 12 });

    const response = await GET(
      new Request("http://localhost/api/projects/p/doc?since=10"),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Doc-Seq")).toBe("12");
    expect(response.headers.get("X-Doc-Full")).toBe("0");

    const target = new Y.Doc();
    Y.applyUpdate(target, new Uint8Array(await response.arrayBuffer()));
    expect(target.getMap("item").toJSON()).toEqual({ x: 10, y: 20 });
  });

  it("marks a compacted recovery response as a full document", async () => {
    const source = new Y.Doc();
    source.getMap("item").set("x", 30);

    mocks.readDocSince.mockResolvedValue({
      full: true,
      state: Y.encodeStateAsUpdate(source),
      seq: 30
    });

    const response = await GET(
      new Request("http://localhost/api/projects/p/doc?since=10"),
      context
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Doc-Seq")).toBe("30");
    expect(response.headers.get("X-Doc-Full")).toBe("1");

    const target = new Y.Doc();
    Y.applyUpdate(target, new Uint8Array(await response.arrayBuffer()));
    expect(target.getMap("item").toJSON()).toEqual({ x: 30 });
  });
});
