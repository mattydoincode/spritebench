import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  emptyTexturesExport,
  parseSlotExport,
  persistSlotExport,
  readSlotExport
} from "@/server/engineExport";
import { LocalFsStorage, setStorage } from "@/storage";

describe("parseSlotExport", () => {
  it("roundtrips a still", () => {
    const exported = {
      intent: "texture" as const,
      remoteHash: "abc",
      path: "p/p1/exports/foo.png"
    };
    expect(parseSlotExport(exported)).toEqual(exported);
  });

  it("roundtrips a bag", () => {
    const exported = {
      intent: "textures" as const,
      remoteHash: "abc",
      frames: [{ file: "00.png", path: "p/p1/engine/s1/00.png" }]
    };
    expect(parseSlotExport(exported)).toEqual(exported);
  });

  it("roundtrips an empty bag", () => {
    const exported = emptyTexturesExport();
    expect(exported.frames).toEqual([]);
    expect(exported.remoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parseSlotExport(exported)).toEqual(exported);
  });

  it("rejects a still without a path", () => {
    expect(parseSlotExport({ intent: "texture", remoteHash: "x" })).toBeNull();
  });
});

describe("persistSlotExport", () => {
  afterEach(() => setStorage(null));

  it("reads back what assign wrote", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sb-export-"));
    setStorage(new LocalFsStorage(dir));
    const exported = {
      intent: "texture" as const,
      remoteHash: "deadbeef",
      path: "p/p1/exports/foo.png"
    };
    await persistSlotExport("p1", "s1", exported);
    expect(await readSlotExport("p1", "s1")).toEqual(exported);
    await rm(dir, { recursive: true, force: true });
  });
});
