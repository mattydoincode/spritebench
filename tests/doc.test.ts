import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import * as doc from "@/shared/doc";
import { emptyTiles } from "@/core/terrain";
import {
  DEFAULT_PROJECT_SETTINGS,
  defaultTerrain,
  paletteBakeAssetIds,
  repeaterFromItem,
  type RepeatGroup,
  type StagedItem
} from "@/shared/model";

function item(id: string, overrides: Partial<StagedItem> = {}): StagedItem {
  return {
    id,
    assetId: `asset_${id}`,
    x: 0,
    y: 0,
    footprint: { width: 0, height: 0 },
    zIndex: 1,
    flipHorizontal: false,
    flipVertical: false,
    isoTurn: 0,
    showSource: false,
    opacity: 1,
    paused: false,
    sequenceId: "",
    heldFrame: 0,
    rotation: 0,
    ...overrides
  };
}

/** A doc with one scene, ready to edit. */
function seeded(sceneId = "pg"): Y.Doc {
  const created = doc.createDoc();
  doc.createScene(created, sceneId, "main");
  return created;
}

/** Every update one doc produces, in the order it produced them. */
function recorder(source: Y.Doc): Uint8Array[] {
  const updates: Uint8Array[] = [];
  source.on("update", (update: Uint8Array) => updates.push(update));
  return updates;
}

describe("document convergence", () => {
  /**
   * The property the whole design rests on: two people editing at once end up
   * with the same document regardless of what order the updates arrive in.
   * If this breaks, the polling transport -- which makes no ordering promise
   * across clients -- is unsound.
   */
  it("reaches the same state whichever order divergent streams are applied", () => {
    const base = seeded();
    const state = doc.encodeState(base);

    const alice = doc.docFromState(state);
    const bob = doc.docFromState(state);

    const fromAlice = recorder(alice);
    const fromBob = recorder(bob);

    doc.addItem(alice, "pg", item("a", { x: 10 }));
    doc.patchScene(alice, "pg", { unitsPerCell: 32 });

    doc.addItem(bob, "pg", item("b", { x: 20 }));
    doc.patchScene(bob, "pg", { palette: "pal1" });

    const forwards = doc.docFromState(state);
    for (const update of [...fromAlice, ...fromBob]) doc.applyRemote(forwards, update);

    const backwards = doc.docFromState(state);
    for (const update of [...fromBob, ...fromAlice]) doc.applyRemote(backwards, update);

    // Interleaved, and each stream out of its own order, which a lossy poll
    // followed by a catch-up can produce.
    const shuffled = doc.docFromState(state);
    for (const update of [fromBob[1], fromAlice[1], fromBob[0], fromAlice[0]]) {
      doc.applyRemote(shuffled, update);
    }

    const read = (target: Y.Doc) => doc.readScene(target, "pg");

    expect(read(backwards)).toEqual(read(forwards));
    expect(read(shuffled)).toEqual(read(forwards));

    const merged = read(forwards);
    expect(merged?.items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(merged?.unitsPerCell).toBe(32);
    expect(merged?.palette).toBe("pal1");
  });

  it("is idempotent, so a re-delivered update changes nothing", () => {
    const source = seeded();
    const updates = recorder(source);

    doc.addItem(source, "pg", item("a"));

    const target = doc.docFromState(doc.encodeState(seeded()));
    for (const update of updates) doc.applyRemote(target, update);

    const once = doc.readScene(target, "pg");
    for (const update of [...updates, ...updates]) doc.applyRemote(target, update);

    expect(doc.readScene(target, "pg")).toEqual(once);
  });

  /**
   * Independent properties still merge: moving a sprite does not discard a
   * collaborator's opacity edit.
   */
  it("merges concurrent edits to different fields of the same item", () => {
    const base = seeded();
    doc.addItem(base, "pg", item("a", { x: 0, y: 0, opacity: 1 }));

    const state = doc.encodeState(base);
    const alice = doc.docFromState(state);
    const bob = doc.docFromState(state);

    doc.patchItem(alice, "pg", "a", { x: 100, y: 200 });
    doc.patchItem(bob, "pg", "a", { opacity: 0.5 });

    doc.applyRemote(alice, Y.encodeStateAsUpdate(bob));
    doc.applyRemote(bob, Y.encodeStateAsUpdate(alice));

    for (const target of [alice, bob]) {
      const moved = doc.readScene(target, "pg")?.items[0];
      expect(moved?.x).toBe(100);
      expect(moved?.y).toBe(200);
      expect(moved?.opacity).toBe(0.5);
    }
  });

  it("resolves concurrent coordinate edits to one complete position", () => {
    const base = seeded();
    doc.addItem(base, "pg", item("a"));

    const state = doc.encodeState(base);
    const alice = doc.docFromState(state);
    const bob = doc.docFromState(state);

    // These used to be independent x/y registers and merged into (100, 200),
    // a position neither person selected.
    doc.patchItem(alice, "pg", "a", { x: 100 });
    doc.patchItem(bob, "pg", "a", { y: 200 });

    doc.applyRemote(alice, Y.encodeStateAsUpdate(bob));
    doc.applyRemote(bob, Y.encodeStateAsUpdate(alice));

    const alicePosition = doc.readScene(alice, "pg")?.items[0];
    const bobPosition = doc.readScene(bob, "pg")?.items[0];
    const position = { x: alicePosition?.x, y: alicePosition?.y };

    expect({ x: bobPosition?.x, y: bobPosition?.y }).toEqual(position);
    expect([
      { x: 100, y: 0 },
      { x: 0, y: 200 }
    ]).toContainEqual(position);
  });

  it("lets a causally later absolute move replace the earlier position", () => {
    const base = seeded();
    doc.addItem(base, "pg", item("a"));

    const alice = doc.docFromState(doc.encodeState(base));
    const bob = doc.docFromState(doc.encodeState(base));

    doc.patchItem(alice, "pg", "a", { x: 100, y: 110 });
    doc.applyRemote(bob, Y.encodeStateAsUpdate(alice));

    doc.patchItem(bob, "pg", "a", { x: 200, y: 210 });
    doc.applyRemote(alice, Y.encodeStateAsUpdate(bob));

    for (const target of [alice, bob]) {
      const moved = doc.readScene(target, "pg")?.items[0];
      expect({ x: moved?.x, y: moved?.y }).toEqual({ x: 200, y: 210 });
    }
  });

  /**
   * `bringToFront` computes max + 1, so two clients independently raising
   * different sprites both land on the same number. Without a tie-break the
   * two would render different stacks.
   */
  it("orders a zIndex tie identically on every client", () => {
    const base = seeded();
    doc.addItem(base, "pg", item("zebra", { zIndex: 5 }));
    doc.addItem(base, "pg", item("apple", { zIndex: 5 }));

    const state = doc.encodeState(base);
    const order = (target: Y.Doc) =>
      doc.readScene(target, "pg")?.items.map((entry) => entry.id);

    expect(order(doc.docFromState(state))).toEqual(["apple", "zebra"]);
    expect(order(doc.docFromState(state))).toEqual(order(base));
  });
});

describe("compaction", () => {
  /**
   * The server periodically merges the update log into a single state blob.
   * A client that loads the compacted state must see exactly what a client
   * that replayed every update sees, or compaction silently loses edits.
   */
  it("gives a compacted state the same content as a full replay", () => {
    const source = doc.createDoc();
    const updates = recorder(source);

    doc.createScene(source, "pg", "main");
    doc.addItem(source, "pg", item("a", { x: 1 }));
    doc.patchItem(source, "pg", "a", { x: 2 });
    doc.addItem(source, "pg", item("b"));
    doc.removeItem(source, "pg", "b");
    doc.patchScene(source, "pg", { name: "renamed" });

    const compacted = doc.docFromState(doc.encodeState(source));

    const replayed = doc.createDoc();
    for (const update of updates) doc.applyRemote(replayed, update);

    expect(doc.readScene(compacted, "pg")).toEqual(doc.readScene(source, "pg"));
    expect(doc.readScene(replayed, "pg")?.items.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("undo manager origin scoping", () => {
  /** The same configuration `DocSync` builds, so these assert real behaviour. */
  function withUndo(target: Y.Doc): Y.UndoManager {
    return new Y.UndoManager([doc.scenesMap(target), doc.assetEditsMap(target)], {
      trackedOrigins: new Set([doc.LOCAL_ORIGIN]),
      captureTimeout: 0
    });
  }

  /**
   * The attribution requirement: Ctrl+Z takes back your last edit, not the
   * one a collaborator happened to make in between.
   */
  it("steps over a remote edit made between two local ones", () => {
    const local = seeded();
    const remote = doc.docFromState(doc.encodeState(local));

    doc.addItem(local, "pg", item("mine", { x: 10 }));

    const undo = withUndo(local);

    doc.patchItem(local, "pg", "mine", { x: 20 });

    // A collaborator's edit, arriving as a remote update.
    doc.addItem(remote, "pg", item("theirs", { x: 99 }));
    doc.applyRemote(local, Y.encodeStateAsUpdate(remote));

    doc.patchItem(local, "pg", "mine", { x: 30 });

    expect(undo.canUndo()).toBe(true);
    undo.undo();

    const afterOne = doc.readScene(local, "pg");
    expect(afterOne?.items.find((entry) => entry.id === "mine")?.x).toBe(20);
    expect(afterOne?.items.find((entry) => entry.id === "theirs")?.x).toBe(99);

    undo.undo();

    const afterTwo = doc.readScene(local, "pg");
    expect(afterTwo?.items.find((entry) => entry.id === "mine")?.x).toBe(10);
    // Still there: undoing your own work never removes someone else's.
    expect(afterTwo?.items.some((entry) => entry.id === "theirs")).toBe(true);
  });

  it("has nothing to undo when only remote edits have arrived", () => {
    const local = seeded();
    const undo = withUndo(local);
    const remote = doc.docFromState(doc.encodeState(local));

    doc.addItem(remote, "pg", item("theirs"));
    doc.applyRemote(local, Y.encodeStateAsUpdate(remote));

    expect(undo.canUndo()).toBe(false);
  });

  /**
   * A drag writes one transaction on pointerup rather than one per
   * pointermove, so it costs one Ctrl+Z. Writing per frame made undo useless.
   */
  it("treats a batched gesture as one undo step", () => {
    const local = seeded();
    doc.addItem(local, "pg", item("a"));
    doc.addItem(local, "pg", item("b"));

    const undo = withUndo(local);

    doc.transactLocal(local, () => {
      doc.patchItem(local, "pg", "a", { x: 50 });
      doc.patchItem(local, "pg", "b", { x: 50 });
    });

    undo.undo();

    const reverted = doc.readScene(local, "pg");
    expect(reverted?.items.map((entry) => entry.x)).toEqual([0, 0]);
    expect(undo.canUndo()).toBe(false);
  });

  it("redoes what it undid", () => {
    const local = seeded();
    const undo = withUndo(local);

    doc.addItem(local, "pg", item("a", { x: 7 }));

    undo.undo();
    expect(doc.readScene(local, "pg")?.items).toEqual([]);

    undo.redo();
    expect(doc.readScene(local, "pg")?.items[0]?.x).toBe(7);
  });
});

describe("defensive reads", () => {
  /**
   * A collaborator on an older build can leave a key absent or write a
   * surprising type. A missing `opacity` must not render the sprite invisible.
   */
  it("substitutes defaults for missing and wrongly typed fields", () => {
    const target = seeded();
    const items = (
      doc.scenesMap(target).get("pg")?.get("items") as Y.Map<Y.Map<unknown>>
    );

    const sparse = new Y.Map<unknown>();
    items.set("odd", sparse);
    sparse.set("assetId", "asset_1");
    sparse.set("opacity", "very"); // wrong type
    // x, y, footprint, zIndex and the flags never written at all

    const read = doc.readScene(target, "pg")?.items[0];

    expect(read?.opacity).toBe(1);
    expect(read?.x).toBe(0);
    expect(read?.footprint).toEqual({ width: 0, height: 0 });
    expect(read?.flipHorizontal).toBe(false);
    expect(read?.paused).toBe(false);
    expect(read?.sequenceId).toBe("");
    expect(read?.heldFrame).toBe(0);
    expect(read?.rotation).toBe(0);
  });

  it("round-trips playground animation fields", () => {
    const source = seeded();
    doc.addItem(source, "pg", item("a", { paused: true, sequenceId: "walk", heldFrame: 3 }));

    const read = doc.readScene(source, "pg")?.items[0];
    expect(read?.paused).toBe(true);
    expect(read?.sequenceId).toBe("walk");
    expect(read?.heldFrame).toBe(3);
    expect(read?.display).toBe("cell");
  });

  it("round-trips item rotation", () => {
    const source = seeded();
    doc.addItem(source, "pg", item("a", { rotation: 135 }));

    expect(doc.readScene(source, "pg")?.items[0]?.rotation).toBe(135);
  });

  it("round-trips iso turn", () => {
    const source = seeded();
    doc.addItem(source, "pg", item("a", { isoTurn: 1 }));

    expect(doc.readScene(source, "pg")?.items[0]?.isoTurn).toBe(1);
  });

  it("round-trips sheet display for item grids", () => {
    const source = seeded();
    doc.addItem(source, "pg", item("a", { display: "sheet" }));

    expect(doc.readScene(source, "pg")?.items[0]?.display).toBe("sheet");
  });

  it("returns null for a scene that is not there", () => {
    expect(doc.readScene(doc.createDoc(), "missing")).toBeNull();
    expect(doc.readAssetEdits(doc.createDoc(), "missing")).toBeNull();
  });
});

describe("asset edits", () => {
  it("seeds an asset's editable half from the settings it was generated under", () => {
    const target = doc.createDoc();

    doc.ensureAssetEdits(target, "asset_1", {
      folder: "props",
      processing: { ...DEFAULT_PROCESSING, erodePixels: 3 }
    });

    const edits = doc.readAssetEdits(target, "asset_1");
    expect(edits?.folder).toBe("props");
    expect(edits?.processing.erodePixels).toBe(3);
    expect(edits?.name).toBe("");
  });

  /**
   * Every client tries to backfill on its next poll, so this runs many times
   * for one asset. It must not overwrite an edit someone has since made.
   */
  it("leaves an existing entry alone on a second backfill", () => {
    const target = doc.createDoc();

    doc.ensureAssetEdits(target, "asset_1", { folder: "props", processing: DEFAULT_PROCESSING });
    doc.patchAssetEdits(target, "asset_1", { name: "hero idle" });
    doc.ensureAssetEdits(target, "asset_1", { folder: "other", processing: DEFAULT_PROCESSING });

    const edits = doc.readAssetEdits(target, "asset_1");
    expect(edits?.name).toBe("hero idle");
    expect(edits?.folder).toBe("props");
  });

  it("patches processing field by field rather than replacing it", () => {
    const target = doc.createDoc();

    doc.ensureAssetEdits(target, "asset_1", {
      folder: "",
      processing: { ...DEFAULT_PROCESSING, erodePixels: 3, trimPadding: 2 }
    });

    doc.patchAssetProcessing(target, "asset_1", { erodePixels: 0 });

    const processing = doc.readAssetEdits(target, "asset_1")?.processing;
    expect(processing?.erodePixels).toBe(0);
    expect(processing?.trimPadding).toBe(2);
  });

  it("groups loop members on a set and hides them until extracted", () => {
    const target = doc.createDoc();

    doc.ensureAssetEdits(target, "a", { folder: "", processing: DEFAULT_PROCESSING, hidden: true });
    doc.ensureAssetEdits(target, "b", { folder: "", processing: DEFAULT_PROCESSING, hidden: true });
    doc.upsertSetMember(
      target,
      { id: "batch", kind: "animation", columns: 2, rows: 1 },
      { assetId: "b", index: 1, col: 1, row: 0 }
    );
    doc.upsertSetMember(
      target,
      { id: "batch", kind: "animation", columns: 2, rows: 1 },
      { assetId: "a", index: 0, col: 0, row: 0 }
    );
    doc.upsertSetMember(
      target,
      { id: "batch", kind: "animation", columns: 2, rows: 1 },
      { assetId: "a", index: 0, col: 0, row: 0 }
    );

    const group = doc.listAssetSets(target)[0];
    expect(group.members.map((entry) => entry.assetId)).toEqual(["a", "b"]);
    expect(group.view).toBe("animate");
    expect(doc.readAssetEdits(target, "b")?.hidden).toBe(true);

    doc.setAssetHidden(target, "b", false);
    expect(doc.readAssetEdits(target, "b")?.hidden).toBe(false);

    doc.patchAssetSet(target, "batch", { view: "grid" });
    expect(doc.listAssetSets(target)[0].view).toBe("grid");
  });

  it("drops a member from its set when the asset is purged", () => {
    const target = doc.createDoc();
    doc.createScene(target, "pg", "main");
    doc.ensureAssetEdits(target, "a", { folder: "", processing: DEFAULT_PROCESSING });
    doc.upsertSetMember(
      target,
      { id: "batch", kind: "grid", columns: 2, rows: 1 },
      { assetId: "a", index: 0, col: 0, row: 0 }
    );

    doc.purgeAsset(target, "a");
    expect(doc.listAssetSets(target)).toEqual([]);
  });
});

describe("project settings", () => {
  it("falls back to the house style until someone sets one", () => {
    const target = doc.createDoc();

    expect(doc.readProjectSettings(target)).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  /**
   * Absent and empty are different. Clearing the prefix has to stay cleared,
   * or the default would reappear on the next load and quietly change what
   * every generation produces.
   */
  it("keeps a deliberately emptied prefix empty", () => {
    const target = doc.createDoc();

    doc.patchProjectSettings(target, { promptPrefix: "" });

    expect(doc.readProjectSettings(target).promptPrefix).toBe("");
    expect(doc.readProjectSettings(target).promptSuffix).toBe(
      DEFAULT_PROJECT_SETTINGS.promptSuffix
    );
  });

  it("merges two collaborators editing different halves of the wrapper", () => {
    const a = doc.createDoc();
    const b = doc.createDoc();

    doc.patchProjectSettings(a, { promptPrefix: "top down" });
    doc.patchProjectSettings(b, { promptSuffix: "no shadow" });

    doc.applyRemote(a, Y.encodeStateAsUpdate(b));
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    expect(doc.readProjectSettings(a)).toEqual(doc.readProjectSettings(b));
    expect(doc.readProjectSettings(a)).toEqual({
      promptPrefix: "top down",
      promptSuffix: "no shadow"
    });
  });

  it("survives compaction", () => {
    const target = doc.createDoc();
    doc.patchProjectSettings(target, { promptPrefix: "isometric" });

    const restored = doc.docFromState(doc.encodeState(target));

    expect(doc.readProjectSettings(restored).promptPrefix).toBe("isometric");
  });

  it("ignores a wrongly typed field rather than rendering it", () => {
    const target = doc.createDoc();
    doc.projectMap(target).set("promptPrefix", 42);

    expect(doc.readProjectSettings(target).promptPrefix).toBe(
      DEFAULT_PROJECT_SETTINGS.promptPrefix
    );
  });
});

describe("prompt snippets", () => {
  it("starts empty and round-trips a named version", () => {
    const target = doc.createDoc();

    expect(doc.listPromptSnippets(target)).toEqual([]);

    doc.putPromptSnippet(target, {
      id: "s1",
      name: "16-bit house",
      kind: "prefix",
      text: "pixel art, 16-bit"
    });

    expect(doc.listPromptSnippets(target)).toEqual([
      { id: "s1", name: "16-bit house", kind: "prefix", text: "pixel art, 16-bit" }
    ]);
  });

  it("keeps two people saving at once from overwriting each other", () => {
    const a = doc.createDoc();
    const b = doc.createDoc();

    doc.putPromptSnippet(a, { id: "a1", name: "from a", kind: "suffix", text: "transparent" });
    doc.putPromptSnippet(b, { id: "b1", name: "from b", kind: "suffix", text: "no shadow" });

    doc.applyRemote(a, Y.encodeStateAsUpdate(b));
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    expect(doc.listPromptSnippets(a)).toEqual(doc.listPromptSnippets(b));
    expect(doc.listPromptSnippets(a).map((entry) => entry.id).sort()).toEqual(["a1", "b1"]);
  });

  it("drops a snippet with an unknown kind rather than inventing one", () => {
    const target = doc.createDoc();
    const map = new Y.Map<unknown>();
    map.set("name", "mystery");
    map.set("kind", "style");
    map.set("text", "nope");
    doc.promptSnippetsMap(target).set("bad", map);

    expect(doc.listPromptSnippets(target)).toEqual([]);
  });
});

describe("repeater names", () => {
  function group(id: string, overrides: Partial<RepeatGroup> = {}): RepeatGroup {
    return {
      id,
      name: "",
      assetIds: [],
      x: 0,
      y: 0,
      cell: { width: 0, height: 0 },
      marginX: 0,
      marginY: 0,
      countX: 3,
      countY: 3,
      fillX: false,
      fillY: false,
      placement: "grid",
      rotate: "none",
      scatterCount: 16,
      areaWidth: 192,
      areaHeight: 192,
      scaleJitter: 0,
      minGap: 0,
      edgeBias: 0,
      background: "",
      zIndex: 1,
      opacity: 1,
      seed: 0,
      ...overrides
    };
  }

  const only = (source: Y.Doc) => doc.listScenes(source)[0].groups[0];

  it("round-trips a name through the document", () => {
    const source = seeded();
    doc.addGroup(source, "pg", group("g1", { name: "hedge row" }));

    expect(only(source).name).toBe("hedge row");

    doc.patchGroup(source, "pg", "g1", { name: "back wall" });
    expect(only(source).name).toBe("back wall");
  });

  /** Unnamed is the normal state, and has to survive a reload as a string. */
  it("reads an unnamed repeater as empty rather than undefined", () => {
    const source = seeded();
    doc.addGroup(source, "pg", group("g1"));

    expect(only(source).name).toBe("");
  });

  it("round-trips scatter placement and spin", () => {
    const source = seeded();
    doc.addGroup(
      source,
      "pg",
      group("g1", {
        placement: "scatter",
        rotate: "free",
        scatterCount: 24,
        areaWidth: 80,
        areaHeight: 40,
        scaleJitter: 0.4,
        minGap: 6,
        edgeBias: 0.5
      })
    );

    expect(only(source)).toMatchObject({
      placement: "scatter",
      rotate: "free",
      scatterCount: 24,
      areaWidth: 80,
      areaHeight: 40,
      scaleJitter: 0.4,
      minGap: 6,
      edgeBias: 0.5
    });
  });

  it("round-trips iso placement", () => {
    const source = seeded();
    doc.addGroup(source, "pg", group("g1", { placement: "iso", countX: 5, countY: 4 }));

    expect(only(source)).toMatchObject({ placement: "iso", countX: 5, countY: 4 });
  });

  /**
   * A rename is a single map key, so two people renaming at once converge on
   * one of the two names rather than on a merged string.
   */
  it("settles on one name when two clients rename at once", () => {
    const a = seeded();
    doc.addGroup(a, "pg", group("g1", { name: "start" }));

    const b = doc.createDoc();
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    doc.patchGroup(a, "pg", "g1", { name: "from a" });
    doc.patchGroup(b, "pg", "g1", { name: "from b" });

    doc.applyRemote(a, Y.encodeStateAsUpdate(b));
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    expect(only(a).name).toBe(only(b).name);
    expect(["from a", "from b"]).toContain(only(a).name);
  });
});

describe("convert item to repeater", () => {
  it("keeps the sprite's origin, footprint, and art", () => {
    const group = repeaterFromItem(
      item("i1", {
        assetId: "grass",
        x: 40,
        y: -8,
        footprint: { width: 32, height: 16 },
        opacity: 0.5,
        zIndex: 4
      }),
      "g1",
      99
    );

    expect(group).toMatchObject({
      id: "g1",
      assetIds: ["grass"],
      x: 40,
      y: -8,
      cell: { width: 32, height: 16 },
      countX: 3,
      countY: 3,
      placement: "grid",
      areaWidth: 96,
      areaHeight: 48,
      opacity: 0.5,
      zIndex: 4,
      seed: 99
    });
  });

  it("swaps the item for a repeater in one document write", () => {
    const source = seeded();
    doc.addItem(
      source,
      "pg",
      item("i1", { assetId: "grass", x: 12, y: 24, footprint: { width: 48, height: 48 } })
    );

    const group = doc.convertItemToRepeater(source, "pg", "i1", "g1", 7);
    const scene = doc.listScenes(source)[0];

    expect(group?.id).toBe("g1");
    expect(scene.items).toEqual([]);
    expect(scene.groups).toHaveLength(1);
    expect(scene.groups[0]).toMatchObject({
      id: "g1",
      assetIds: ["grass"],
      x: 12,
      y: 24,
      cell: { width: 48, height: 48 },
      seed: 7
    });
  });

  it("does nothing when the item is already gone", () => {
    const source = seeded();
    expect(doc.convertItemToRepeater(source, "pg", "missing", "g1", 1)).toBeNull();
    expect(doc.listScenes(source)[0].groups).toEqual([]);
  });
});

describe("terrain", () => {
  const only = (source: Y.Doc) => doc.listScenes(source)[0].terrains[0];

  it("round-trips a terrain through the document", () => {
    const source = seeded();
    doc.addTerrain(
      source,
      "pg",
      defaultTerrain("t1", 8, 16)
    );

    expect(only(source)).toMatchObject({
      id: "t1",
      x: 8,
      y: 16,
      countX: 1,
      countY: 1,
      samples: 512,
      low: 0,
      high: 8,
      seaLevel: 3,
      flattenSea: true,
      gradientId: "classic",
      tiles: [{ heightAssetId: "", colorAssetId: "" }]
    });
  });

  it("round-trips a raised sample count", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", { ...defaultTerrain("t1", 0, 0), samples: 256 });
    expect(only(source).samples).toBe(256);

    doc.patchTerrain(source, "pg", "t1", { samples: 2048 });
    expect(only(source).samples).toBe(2048);
  });

  it("reads an unnamed terrain as empty rather than undefined", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", defaultTerrain("t1", 0, 0));
    expect(only(source).name).toBe("");
  });

  it("assigns a heightmap to one cell without wiping the others", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", {
      ...defaultTerrain("t1", 0, 0),
      countX: 2,
      countY: 1,
      tiles: emptyTiles(2, 1)
    });
    doc.setTerrainTile(source, "pg", "t1", 1, { heightAssetId: "hill" });

    expect(only(source).tiles).toEqual([
      { heightAssetId: "", colorAssetId: "" },
      { heightAssetId: "hill", colorAssetId: "" }
    ]);
  });

  it("reads missing fields as defaults, including an unknown gradient", () => {
    const source = seeded();
    const scene = doc.scenesMap(source).get("pg");
    const terrains = new Y.Map<Y.Map<unknown>>();
    const map = new Y.Map<unknown>();
    map.set("gradientId", "lava");
    terrains.set("t1", map);
    scene?.set("terrains", terrains);

    expect(only(source)).toMatchObject({
      id: "t1",
      countX: 1,
      countY: 1,
      samples: 512,
      low: 0,
      high: 8,
      flattenSea: true,
      gradientId: "classic",
      tiles: [{ heightAssetId: "", colorAssetId: "" }]
    });
  });

  it("can add a terrain to a scene that never had a terrains map", () => {
    const source = seeded();
    doc.scenesMap(source).get("pg")?.delete("terrains");

    expect(doc.listScenes(source)[0].terrains).toEqual([]);

    doc.addTerrain(source, "pg", defaultTerrain("t1", 0, 0));
    expect(doc.listScenes(source)[0].terrains).toHaveLength(1);
  });

  it("merges tile edits on different cells", () => {
    const a = seeded();
    doc.addTerrain(a, "pg", {
      ...defaultTerrain("t1", 0, 0),
      countX: 2,
      countY: 1,
      tiles: emptyTiles(2, 1)
    });

    const b = doc.createDoc();
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    doc.setTerrainTile(a, "pg", "t1", 0, { heightAssetId: "from-a" });
    doc.setTerrainTile(b, "pg", "t1", 1, { heightAssetId: "from-b" });

    doc.applyRemote(a, Y.encodeStateAsUpdate(b));
    doc.applyRemote(b, Y.encodeStateAsUpdate(a));

    expect(only(a).tiles).toEqual(only(b).tiles);
    expect(only(a).tiles).toEqual([
      { heightAssetId: "from-a", colorAssetId: "" },
      { heightAssetId: "from-b", colorAssetId: "" }
    ]);
  });

  it("keeps overlapping tiles when the grid grows", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", defaultTerrain("t1", 0, 0));
    doc.setTerrainTile(source, "pg", "t1", 0, { heightAssetId: "a", colorAssetId: "c" });
    doc.patchTerrain(source, "pg", "t1", { countX: 2, countY: 1 });

    expect(only(source).tiles).toEqual([
      { heightAssetId: "a", colorAssetId: "c" },
      { heightAssetId: "", colorAssetId: "" }
    ]);
  });

  it("clears terrain slots when an asset is purged", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", defaultTerrain("t1", 0, 0));
    doc.setTerrainTile(source, "pg", "t1", 0, { heightAssetId: "gone", colorAssetId: "keep" });
    doc.purgeAsset(source, "gone");

    expect(only(source).tiles[0]).toEqual({ heightAssetId: "", colorAssetId: "keep" });
  });

  it("clears terrains with the rest of the scene", () => {
    const source = seeded();
    doc.addTerrain(source, "pg", defaultTerrain("t1", 0, 0));
    doc.clearScene(source, "pg");
    expect(doc.listScenes(source)[0].terrains).toEqual([]);
  });

  it("keeps heightmaps out of a palette bake", () => {
    const source = seeded();
    doc.addItem(source, "pg", item("i1", { assetId: "sprite" }));
    doc.addTerrain(source, "pg", {
      ...defaultTerrain("t1", 0, 0),
      tiles: [{ heightAssetId: "height", colorAssetId: "albedo" }]
    });

    expect(paletteBakeAssetIds(doc.listScenes(source)[0]).sort()).toEqual(["albedo", "sprite"]);
  });
});
