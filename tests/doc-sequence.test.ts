import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROCESSING } from "@/core/settings";
import * as doc from "@/shared/doc";
import type { Sequence, SequenceFrame } from "@/shared/sequence";

const ASSET = "sheet-1";

function frame(id: string, x: number, hold = 1): SequenceFrame {
  return {
    id,
    sourceAssetId: ASSET,
    rect: { x, y: 0, width: 20, height: 20 },
    edits: [],
    hold
  };
}

function walk(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: "seq-1",
    name: "walk",
    fps: 10,
    playback: "loop",
    inset: { top: 1, right: 2, bottom: 3, left: 4 },
    frames: [frame("f0", 0), frame("f1", 20), frame("f2", 40)],
    ...overrides
  };
}

/** A doc with one asset's editable half already seeded. */
function seeded(): Y.Doc {
  const created = doc.createDoc();
  doc.ensureAssetEdits(created, ASSET, { folder: "", processing: DEFAULT_PROCESSING });
  return created;
}

function read(source: Y.Doc, sequenceId = "seq-1"): Sequence | undefined {
  return doc.readAssetEdits(source, ASSET)?.sequences[sequenceId];
}

describe("sequences in the document", () => {
  it("round-trips through Yjs unchanged", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());

    expect(read(source)).toEqual(walk());
  });

  it("survives an encode and decode, which is what the server stores", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());

    const restored = doc.docFromState(doc.encodeState(source));

    expect(read(restored)).toEqual(walk());
  });

  it("keeps several animations on one sheet apart", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.putSequence(source, ASSET, walk({ id: "seq-2", name: "idle", frames: [frame("g0", 0)] }));

    const edits = doc.readAssetEdits(source, ASSET);

    expect(Object.keys(edits?.sequences ?? {}).sort()).toEqual(["seq-1", "seq-2"]);
    expect(edits?.sequences["seq-2"].frames).toHaveLength(1);
  });

  it("patches the sequence without touching its frames", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.patchSequence(source, ASSET, "seq-1", { fps: 24, playback: "pingPong" });

    expect(read(source)).toMatchObject({ fps: 24, playback: "pingPong" });
    expect(read(source)?.frames).toHaveLength(3);
  });

  it("clamps a nonsense fps on the way in", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.patchSequence(source, ASSET, "seq-1", { fps: 9000 });

    expect(read(source)?.fps).toBe(60);
  });

  it("patches one frame by id, not by position", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.patchSequenceFrame(source, ASSET, "seq-1", "f1", { hold: 4 });

    expect(read(source)?.frames.map((entry) => entry.hold)).toEqual([1, 4, 1]);
  });

  it("stores per-frame edits", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.patchSequenceFrame(source, ASSET, "seq-1", "f0", {
      edits: [{ kind: "crop", x: 2, y: 2, width: 8, height: 8 }]
    });

    expect(read(source)?.frames[0].edits).toEqual([
      { kind: "crop", x: 2, y: 2, width: 8, height: 8 }
    ]);
  });

  it("replaces the whole frame list on a re-slice", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.replaceSequenceFrames(source, ASSET, "seq-1", [frame("n0", 0), frame("n1", 32)]);

    expect(read(source)?.frames.map((entry) => entry.id)).toEqual(["n0", "n1"]);
  });

  it("deletes one animation and leaves the others", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.putSequence(source, ASSET, walk({ id: "seq-2", name: "idle" }));
    doc.deleteSequence(source, ASSET, "seq-1");

    expect(read(source)).toBeUndefined();
    expect(read(source, "seq-2")).toBeDefined();
  });

  it("goes away with the asset", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.purgeAsset(source, ASSET);

    expect(doc.readAssetEdits(source, ASSET)).toBeNull();
  });

  it("reports no sequences for an asset that has never had one", () => {
    expect(doc.readAssetEdits(seeded(), ASSET)?.sequences).toEqual({});
  });

  /**
   * Frames are a Y.Array of Y.Map rather than one plain array, so two people
   * appending at the same moment both land. A single register would resolve
   * to whichever write arrived second and silently drop the other.
   */
  it("merges concurrent frame edits from two clients", () => {
    const base = seeded();
    doc.putSequence(base, ASSET, walk());

    const state = doc.encodeState(base);
    const alice = doc.docFromState(state);
    const bob = doc.docFromState(state);

    doc.patchSequenceFrame(alice, ASSET, "seq-1", "f0", { hold: 5 });
    doc.patchSequenceFrame(bob, ASSET, "seq-1", "f2", { hold: 7 });

    doc.applyRemote(alice, doc.encodeState(bob));
    doc.applyRemote(bob, doc.encodeState(alice));

    expect(read(alice)?.frames.map((entry) => entry.hold)).toEqual([5, 1, 7]);
    expect(read(bob)?.frames.map((entry) => entry.hold)).toEqual([5, 1, 7]);
  });

  it("survives a collaborator writing junk into a frame", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());

    // Simulates an older or buggier client. The reader must degrade, not throw.
    const sequences = doc.assetEditsMap(source).get(ASSET)?.get("sequences") as Y.Map<Y.Map<unknown>>;
    const frames = sequences.get("seq-1")?.get("frames") as Y.Array<Y.Map<unknown>>;
    frames.get(0).set("rect", "not a rectangle");
    frames.get(1).set("hold", -3);
    sequences.get("seq-1")?.set("playback", "sideways");

    const restored = read(source);

    expect(restored?.frames[0].rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(restored?.frames[1].hold).toBe(1);
    expect(restored?.playback).toBe("loop");
  });

  it("replaces the whole set of animations in one write", () => {
    const source = seeded();
    doc.putSequence(source, ASSET, walk());
    doc.replaceSequences(source, ASSET, [
      walk({ id: "idle", name: "idle", frames: [frame("i0", 0)] }),
      walk({ id: "run", name: "run" })
    ]);

    const edits = doc.readAssetEdits(source, ASSET);
    expect(Object.keys(edits?.sequences ?? {}).sort()).toEqual(["idle", "run"]);
    expect(edits?.sequences.idle.frames).toHaveLength(1);
  });
});
