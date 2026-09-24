import { describe, expect, it } from "vitest";
import {
  assetIdFromCacheKey,
  planEviction,
  processedStoreKey,
  shouldPersistProcessed
} from "@/client/processedCache";

describe("processedStoreKey", () => {
  it("nests the cache key under the project", () => {
    expect(processedStoreKey("proj", "asset:thumb:abc:def")).toBe("proj/asset:thumb:abc:def");
  });
});

describe("assetIdFromCacheKey", () => {
  it("reads the asset id before the first colon", () => {
    expect(assetIdFromCacheKey("asset:thumb:abc:def")).toBe("asset");
  });
});

describe("shouldPersistProcessed", () => {
  it("always keeps thumbs", () => {
    expect(shouldPersistProcessed("thumb", 2000, 2000)).toBe(true);
  });

  it("keeps small source-res results and skips large ones", () => {
    expect(shouldPersistProcessed("source", 512, 64)).toBe(true);
    expect(shouldPersistProcessed("source", 513, 64)).toBe(false);
  });
});

describe("planEviction", () => {
  it("does nothing when the store is under the cap", () => {
    expect(
      planEviction(
        [
          { key: "a", bytes: 10, lastAccess: 2 },
          { key: "b", bytes: 10, lastAccess: 1 }
        ],
        5,
        100
      )
    ).toEqual([]);
  });

  it("evicts least-recently used first until the incoming write fits", () => {
    expect(
      planEviction(
        [
          { key: "fresh", bytes: 40, lastAccess: 30 },
          { key: "old", bytes: 40, lastAccess: 10 },
          { key: "older", bytes: 40, lastAccess: 5 }
        ],
        50,
        100
      )
    ).toEqual(["older", "old"]);
  });

  it("evicts everything else when the incoming item is larger than the cap", () => {
    expect(
      planEviction(
        [
          { key: "a", bytes: 10, lastAccess: 1 },
          { key: "b", bytes: 10, lastAccess: 2 }
        ],
        200,
        100
      )
    ).toEqual(["a", "b"]);
  });
});
