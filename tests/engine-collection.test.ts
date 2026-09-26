import { describe, expect, it } from "vitest";
import {
  fieldSlotLabel,
  normalizeRecordKey,
  reconcileRecords,
  uniqueRecordKey,
  type EngineRecordState
} from "@/shared/engineCollection";
import { fieldSlotId, uuidV5 } from "@/server/fieldSlotId";

function record(overrides: Partial<EngineRecordState> & { id: string }): EngineRecordState {
  return {
    key: overrides.id,
    sort: 0,
    origin: "godot",
    acked: true,
    pending: false,
    removedBy: null,
    ...overrides
  };
}

function byId(states: EngineRecordState[]): Record<string, EngineRecordState> {
  return Object.fromEntries(states.map((state) => [state.id, state]));
}

describe("reconcileRecords", () => {
  it("adds records Godot lists for the first time, in Godot's order", () => {
    const next = reconcileRecords([], [
      { id: "a", key: "brownstone" },
      { id: "b", key: "tower" }
    ]);
    expect(next).toEqual([
      record({ id: "a", key: "brownstone", sort: 0 }),
      record({ id: "b", key: "tower", sort: 1 })
    ]);
  });

  it("takes Godot's key and position for records it already knows", () => {
    const next = byId(
      reconcileRecords(
        [record({ id: "a", key: "old", sort: 0 }), record({ id: "b", sort: 1 })],
        [
          { id: "b", key: "b" },
          { id: "a", key: "renamed" }
        ]
      )
    );
    expect(next.a).toMatchObject({ key: "renamed", sort: 1 });
    expect(next.b).toMatchObject({ sort: 0 });
  });

  it("tombstones an acked record Godot stopped listing", () => {
    const next = byId(reconcileRecords([record({ id: "a" }), record({ id: "b", sort: 1 })], [
      { id: "b", key: "b" }
    ]));
    expect(next.a.removedBy).toBe("godot");
    expect(next.b.removedBy).toBeNull();
  });

  it("keeps a web record Godot has not seen yet, sorted after Godot's", () => {
    const web = record({ id: "w", origin: "web", acked: false, pending: true, sort: 0 });
    const next = byId(reconcileRecords([web], [{ id: "a", key: "a" }]));
    expect(next.w).toMatchObject({ removedBy: null, acked: false, pending: true, sort: 1 });
  });

  it("acks a web record once Godot lists it with the same key", () => {
    const web = record({ id: "w", key: "shop", origin: "web", acked: false, pending: true });
    const next = byId(reconcileRecords([web], [{ id: "w", key: "shop" }]));
    expect(next.w).toMatchObject({ acked: true, pending: false, key: "shop" });
  });

  it("holds a web rename until Godot echoes it back", () => {
    const renamed = record({ id: "a", key: "new", pending: true });
    const first = reconcileRecords([renamed], [{ id: "a", key: "old" }]);
    expect(first[0]).toMatchObject({ key: "new", pending: true });

    const second = reconcileRecords(first, [{ id: "a", key: "new" }]);
    expect(second[0]).toMatchObject({ key: "new", pending: false });
  });

  it("keeps a web delete even while Godot still lists the record", () => {
    const deleted = record({ id: "a", removedBy: "web" });
    const next = reconcileRecords([deleted], [{ id: "a", key: "a" }]);
    expect(next[0].removedBy).toBe("web");
  });

  it("restores a record deleted in Godot when Godot lists it again", () => {
    const deleted = record({ id: "a", removedBy: "godot" });
    const next = reconcileRecords([deleted], [{ id: "a", key: "a" }]);
    expect(next[0].removedBy).toBeNull();
  });

  it("ignores a duplicated id in the payload", () => {
    const next = reconcileRecords([], [
      { id: "a", key: "one" },
      { id: "a", key: "two" }
    ]);
    expect(next).toHaveLength(1);
    expect(next[0].key).toBe("one");
  });
});

describe("record keys", () => {
  it("normalizes whitespace and punctuation", () => {
    expect(normalizeRecordKey("  Corner Shop #2 ")).toBe("Corner_Shop_2");
  });

  it("suffixes a taken key", () => {
    expect(uniqueRecordKey("tower", ["tower", "tower_2"])).toBe("tower_3");
    expect(uniqueRecordKey("!!!", [])).toBe("record");
  });

  it("labels field slots as collection/record.field", () => {
    expect(fieldSlotLabel("buildings", "tower", "front")).toBe("buildings/tower.front");
  });
});

describe("fieldSlotId", () => {
  it("is a v5 uuid matching the RFC 4122 reference", () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "886313e1-3b8a-5372-9b90-0c9aee199e5d"
    );
  });

  it("matches the vector the Godot addon checks", () => {
    expect(fieldSlotId("11111111-2222-4333-8444-555555555555", "front")).toBe(
      "29917306-d641-5d37-bba3-d60a30539cdc"
    );
  });

  it("lowercases the record id", () => {
    expect(fieldSlotId("ABCDEF00-2222-4333-8444-555555555555", "roof")).toBe(
      fieldSlotId("abcdef00-2222-4333-8444-555555555555", "roof")
    );
  });
});
