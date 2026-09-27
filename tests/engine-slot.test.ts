import { describe, expect, it } from "vitest";
import {
  deriveSlotStatus,
  dropSlotAssignment,
  mergeSlotAssignment,
  moveSlotAssignment,
  replaceSlotAssignment,
  laneAssetIds,
  laneFingerprintKey,
  laneKey,
  laneRemoteHash,
  laneStorageId,
  parseLaneKey,
  servedLane
} from "@/shared/engineSlot";
import { hashApiToken, mintApiToken } from "@/server/apiToken";

describe("deriveSlotStatus", () => {
  it("is empty until an export is assigned", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: [],
        localHash: null,
        lastPushedHash: null,
        remoteHash: null
      })
    ).toBe("empty");

    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: null,
        lastPushedHash: null,
        remoteHash: null
      })
    ).toBe("empty");
  });

  it("offers a pull when Godot still has the last push", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: "old",
        lastPushedHash: "old",
        remoteHash: "new"
      })
    ).toBe("pull_available");
  });

  it("is in sync when all three hashes match", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: "same",
        lastPushedHash: "same",
        remoteHash: "same"
      })
    ).toBe("in_sync");
  });

  it("warns when Godot edited and SpriteBench did not", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: "godot",
        lastPushedHash: "pushed",
        remoteHash: "pushed"
      })
    ).toBe("edited_in_godot");
  });

  it("conflicts when both sides changed", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: "godot",
        lastPushedHash: "pushed",
        remoteHash: "web"
      })
    ).toBe("conflict");
  });

  it("treats a new assignment with no local file as a pull", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: ["a"],
        localHash: null,
        lastPushedHash: null,
        remoteHash: "remote"
      })
    ).toBe("pull_available");
  });

  it("offers a pull when an array was cleared but Godot still has files", () => {
    expect(
      deriveSlotStatus({
        assignedAssetIds: [],
        localHash: "old",
        lastPushedHash: "old",
        remoteHash: "empty"
      })
    ).toBe("pull_available");
  });
});

describe("mergeSlotAssignment", () => {
  it("appends unique ids onto an array slot", () => {
    expect(mergeSlotAssignment("textures", ["a"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeSlotAssignment("textures", ["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeSlotAssignment("textures", [], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("keeps a still or clips slot on the first incoming id", () => {
    expect(mergeSlotAssignment("texture", ["old"], ["a", "b"])).toEqual(["a"]);
    expect(mergeSlotAssignment("sprite_frames", [], ["walk", "idle"])).toEqual(["walk"]);
  });
});

describe("replaceSlotAssignment", () => {
  it("replaces an array and drops duplicates", () => {
    expect(replaceSlotAssignment("textures", ["b", "c", "b"])).toEqual(["b", "c"]);
    expect(replaceSlotAssignment("textures", [])).toEqual([]);
  });

  it("keeps a still on the first id or clears it", () => {
    expect(replaceSlotAssignment("texture", ["a", "b"])).toEqual(["a"]);
    expect(replaceSlotAssignment("texture", [])).toEqual([]);
  });
});

describe("dropSlotAssignment", () => {
  it("removes matching ids and keeps the rest in order", () => {
    expect(dropSlotAssignment(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(dropSlotAssignment(["a", "b"], ["a", "b"])).toEqual([]);
    expect(dropSlotAssignment(["a"], [])).toEqual(["a"]);
  });
});

describe("mintApiToken", () => {
  it("mints a hashed sbp_ token and never puts the secret in the prefix", () => {
    const minted = mintApiToken();

    expect(minted.token.startsWith("sbp_")).toBe(true);
    expect(minted.prefix).toBe(minted.token.slice(0, 11));
    expect(minted.hash).toBe(hashApiToken(minted.token));
    expect(minted.hash).not.toContain(minted.token.slice(4));
    expect(hashApiToken("other")).not.toBe(minted.hash);
  });
});

describe("moveSlotAssignment", () => {
  it("moves an entry up and down", () => {
    expect(moveSlotAssignment(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveSlotAssignment(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  });

  it("clamps at the ends and ignores bad indexes", () => {
    expect(moveSlotAssignment(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveSlotAssignment(["a", "b"], 5, 1)).toEqual(["a", "b"]);
  });
});

describe("prototype and final lanes", () => {
  const slot = {
    assignedAssetIds: ["p"],
    finalAssetIds: ["f"],
    remoteHash: "proto-hash",
    finalRemoteHash: "final-hash"
  };

  it("serves the final when the game wants finals and the slot has one", () => {
    expect(servedLane(slot, "final")).toBe("final");
    expect(servedLane({ finalAssetIds: [] }, "final")).toBe("prototype");
    expect(servedLane(slot, "prototype")).toBe("prototype");
  });

  it("reads each lane's art and hash, and keeps their files apart", () => {
    expect(laneAssetIds(slot, "final")).toEqual(["f"]);
    expect(laneAssetIds(slot, "prototype")).toEqual(["p"]);
    expect(laneRemoteHash(slot, "final")).toBe("final-hash");
    expect(laneStorageId("abc", "final")).toBe("abc-final");
    expect(laneStorageId("abc", "prototype")).toBe("abc");
  });

  it("round-trips a lane key", () => {
    expect(parseLaneKey(laneKey("abc", "final"))).toEqual({ slotId: "abc", lane: "final" });
    expect(laneFingerprintKey("abc", "prototype")).toBe("abc");
  });
});
