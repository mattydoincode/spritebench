import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFsStorage } from "@/storage/local";
import {
  basename,
  exportKey,
  paletteKey,
  sourceKey,
  templateKey,
  thumbKey,
  uniqueKey
} from "@/storage/keys";
import { ObjectNotFoundError, assertSafeKey } from "@/storage/types";
import { buildThumbnail } from "@/server/thumbnails";
import { encodePng } from "@/server/png";
import { framed } from "./helpers";

const HELLO = new Uint8Array([104, 105]);

describe("assertSafeKey", () => {
  it("accepts ordinary keys", () => {
    expect(assertSafeKey("sources/a.png")).toBe("sources/a.png");
    expect(assertSafeKey("exports/props/crate_1.png")).toBe("exports/props/crate_1.png");
  });

  const unsafe = [
    "",
    "/etc/passwd",
    "../secrets",
    "sources/../../etc/passwd",
    "sources/./a.png",
    "sources//a.png",
    "sources\\a.png"
  ];

  for (const key of unsafe) {
    it(`rejects ${JSON.stringify(key)}`, () => {
      expect(() => assertSafeKey(key)).toThrow();
    });
  }
});

describe("key layout", () => {
  it("puts each kind of object under its own prefix", () => {
    expect(sourceKey("a.png")).toBe("sources/a.png");
    expect(thumbKey("a")).toBe("thumbs/a.webp");
    expect(templateKey("t.png")).toBe("templates/t.png");
    expect(paletteKey("p.png")).toBe("palettes/p.png");
    expect(exportKey("props", "a.png")).toBe("exports/props/a.png");
    expect(exportKey("", "a.png")).toBe("exports/a.png");
  });

  it("reads the filename back off a key", () => {
    expect(basename("sources/a.png")).toBe("a.png");
    expect(basename("a.png")).toBe("a.png");
  });
});

describe("uniqueKey", () => {
  it("returns the key untouched when it is free", async () => {
    expect(await uniqueKey("sources/a.png", async () => false)).toBe("sources/a.png");
  });

  it("suffixes before the extension, not after", async () => {
    const taken = new Set(["sources/a.png", "sources/a_2.png"]);

    expect(await uniqueKey("sources/a.png", async (key) => taken.has(key))).toBe(
      "sources/a_3.png"
    );
  });

  it("handles a name with no extension", async () => {
    const taken = new Set(["sources/a"]);
    expect(await uniqueKey("sources/a", async (key) => taken.has(key))).toBe("sources/a_2");
  });
});

describe("LocalFsStorage", () => {
  let root: string;
  let storage: LocalFsStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "art-studio-storage-"));
    storage = new LocalFsStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes", async () => {
    await storage.put("sources/a.png", HELLO, { contentType: "image/png" });

    expect(Buffer.from(await storage.get("sources/a.png")).toString()).toBe("hi");
  });

  it("creates missing directories on write", async () => {
    await storage.put("exports/deep/nested/a.png", HELLO);
    expect(await storage.exists("exports/deep/nested/a.png")).toBe(true);
  });

  it("overwrites an existing object", async () => {
    await storage.put("sources/a.png", HELLO);
    await storage.put("sources/a.png", new Uint8Array([120]));

    expect(Buffer.from(await storage.get("sources/a.png")).toString()).toBe("x");
  });

  it("throws ObjectNotFoundError for a missing key", async () => {
    await expect(storage.get("sources/nope.png")).rejects.toThrow(ObjectNotFoundError);
  });

  it("reports head and exists without reading the body", async () => {
    await storage.put("sources/a.png", HELLO);

    const head = await storage.head("sources/a.png");
    expect(head?.size).toBe(2);
    expect(head?.key).toBe("sources/a.png");
    expect(await storage.head("sources/nope.png")).toBeNull();
    expect(await storage.exists("sources/nope.png")).toBe(false);
  });

  it("deletes, and treats deleting a missing key as done", async () => {
    await storage.put("sources/a.png", HELLO);
    await storage.delete("sources/a.png");

    expect(await storage.exists("sources/a.png")).toBe(false);
    await expect(storage.delete("sources/a.png")).resolves.toBeUndefined();
  });

  it("lists a prefix recursively, sorted, and nothing else", async () => {
    await storage.put("sources/b.png", HELLO);
    await storage.put("sources/a.png", HELLO);
    await storage.put("sources/nested/c.png", HELLO);
    await storage.put("thumbs/d.webp", HELLO);

    expect((await storage.list("sources")).map((entry) => entry.key)).toEqual([
      "sources/a.png",
      "sources/b.png",
      "sources/nested/c.png"
    ]);

    expect(await storage.list("missing")).toEqual([]);
  });

  it("refuses to escape its root", async () => {
    await writeFile(path.join(root, "outside.txt"), "secret");

    await expect(storage.get("../outside.txt")).rejects.toThrow(/unsafe/);
    await expect(storage.put("../outside.txt", HELLO)).rejects.toThrow(/unsafe/);
    await expect(storage.delete("../../etc/passwd")).rejects.toThrow(/unsafe/);
  });

  it("hands back a URL the app can serve", async () => {
    await storage.put("sources/a.png", HELLO);

    expect(await storage.signedUrl("sources/a.png", 3600)).toBe("/api/storage/sources/a.png");
  });
});

describe("buildThumbnail", () => {
  const BORDER = { r: 200, g: 30, b: 40 };
  const FILL = { r: 20, g: 60, b: 220 };

  it("produces WebP bytes smaller than the source PNG", async () => {
    const png = encodePng(framed(1024, BORDER, FILL, 200));
    const thumb = await buildThumbnail(png);

    // A WebP file is "RIFF" then a size, then "WEBP".
    expect(Buffer.from(thumb.subarray(0, 4)).toString()).toBe("RIFF");
    expect(Buffer.from(thumb.subarray(8, 12)).toString()).toBe("WEBP");
    expect(thumb.length).toBeLessThan(png.length);
  });

  it("leaves an image already smaller than the box alone", async () => {
    const thumb = await buildThumbnail(encodePng(framed(64, BORDER, FILL, 16)));
    expect(thumb.length).toBeGreaterThan(0);
  });
});
