import { describe, expect, it } from "vitest";
import {
  DRAG_THRESHOLD_PX,
  groupBounds,
  hitsInMarquee,
  idsInMarquee,
  itemBounds,
  pastDragThreshold,
  pointInRect,
  rectFromPoints,
  selectionBounds,
  rectsIntersect,
  selectionOnItemClick,
  selectionOnItemDown,
  selectionOnMarquee,
  selectionOnTargetClick,
  selectionOnTargetDown,
  shouldPan,
  toggleId,
  type SelectableGroup,
  type SelectableItem
} from "@/client/sceneSelect";

function item(patch: Partial<SelectableItem> = {}): SelectableItem {
  return {
    id: "a",
    x: 0,
    y: 0,
    footprint: { width: 32, height: 48 },
    rotation: 0,
    ...patch
  };
}

function group(patch: Partial<SelectableGroup> = {}): SelectableGroup {
  return {
    id: "g",
    x: 0,
    y: 0,
    placement: "grid",
    cell: { width: 16, height: 16 },
    marginX: 0,
    marginY: 0,
    countX: 4,
    countY: 2,
    fillX: false,
    fillY: false,
    areaWidth: 64,
    areaHeight: 32,
    ...patch
  };
}

describe("shouldPan", () => {
  it("pans on middle mouse, Alt, or Space", () => {
    expect(shouldPan({ button: 1, altKey: false }, false)).toBe(true);
    expect(shouldPan({ button: 0, altKey: true }, false)).toBe(true);
    expect(shouldPan({ button: 0, altKey: false }, true)).toBe(true);
  });

  it("does not pan on a plain left click", () => {
    expect(shouldPan({ button: 0, altKey: false }, false)).toBe(false);
  });

  it("does not treat a right click as pan", () => {
    expect(shouldPan({ button: 2, altKey: false }, false)).toBe(false);
  });
});

describe("pastDragThreshold", () => {
  it("ignores a click that has not moved", () => {
    expect(pastDragThreshold(0, 0)).toBe(false);
    expect(pastDragThreshold(2, 2)).toBe(false);
  });

  it("fires once travel reaches the threshold", () => {
    expect(pastDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(true);
    expect(pastDragThreshold(0, -DRAG_THRESHOLD_PX)).toBe(true);
  });
});

describe("toggleId", () => {
  it("adds a missing id and drops a present one", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("rectsIntersect", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };

  it("hits overlapping boxes and misses separated ones", () => {
    expect(rectsIntersect(box, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(box, { x: 11, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it("does not count boxes that only share an edge", () => {
    expect(rectsIntersect(box, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("rectFromPoints", () => {
  it("normalises a drag in any direction", () => {
    expect(rectFromPoints({ x: 40, y: 10 }, { x: 10, y: 30 })).toEqual({
      x: 10,
      y: 10,
      width: 30,
      height: 20
    });
  });
});

describe("itemBounds", () => {
  it("is the footprint when the sprite is upright", () => {
    expect(itemBounds(item({ x: 10, y: 20 }))).toEqual({
      x: 10,
      y: 20,
      width: 32,
      height: 48
    });
  });

  it("expands to the AABB of a rotated footprint", () => {
    const bounds = itemBounds(
      item({
        x: 0,
        y: 0,
        footprint: { width: 40, height: 20 },
        rotation: 90
      })
    );

    expect(bounds.x).toBeCloseTo(10);
    expect(bounds.y).toBeCloseTo(-10);
    expect(bounds.width).toBeCloseTo(20);
    expect(bounds.height).toBeCloseTo(40);
  });
});

describe("idsInMarquee", () => {
  const items = [
    item({ id: "left", x: 0, y: 0, footprint: { width: 32, height: 32 } }),
    item({ id: "right", x: 100, y: 0, footprint: { width: 32, height: 32 } })
  ];

  it("returns ids whose bounds overlap the box", () => {
    expect(idsInMarquee(items, { x: 8, y: 8, width: 8, height: 8 })).toEqual(["left"]);
    expect(idsInMarquee(items, { x: 90, y: -4, width: 20, height: 20 })).toEqual(["right"]);
  });

  it("accepts a backwards drag", () => {
    expect(idsInMarquee(items, { x: 40, y: 40, width: -50, height: -50 })).toEqual(["left"]);
  });

  it("misses a box that does not overlap", () => {
    expect(idsInMarquee(items, { x: 50, y: 50, width: 10, height: 10 })).toEqual([]);
  });
});

describe("groupBounds", () => {
  it("is the grid footprint: cells times counts minus the last margin", () => {
    expect(groupBounds(group())).toEqual({ x: 0, y: 0, width: 64, height: 32 });
  });

  it("uses the scatter area", () => {
    expect(
      groupBounds(
        group({
          placement: "scatter",
          x: 10,
          y: 20,
          areaWidth: 80,
          areaHeight: 40
        })
      )
    ).toEqual({ x: 10, y: 20, width: 80, height: 40 });
  });
});

describe("hitsInMarquee", () => {
  const items = [item({ id: "sprite", x: 0, y: 0, footprint: { width: 16, height: 16 } })];
  const groups = [group({ id: "repeater", x: 100, y: 0 })];

  it("returns sprites and repeaters that overlap the box", () => {
    expect(hitsInMarquee(items, groups, { x: 4, y: 4, width: 8, height: 8 })).toEqual({
      itemIds: ["sprite"],
      groupIds: []
    });
    expect(hitsInMarquee(items, groups, { x: 100, y: 0, width: 10, height: 10 })).toEqual({
      itemIds: [],
      groupIds: ["repeater"]
    });
    expect(hitsInMarquee(items, groups, { x: 0, y: 0, width: 200, height: 40 })).toEqual({
      itemIds: ["sprite"],
      groupIds: ["repeater"]
    });
  });
});

describe("selectionOnItemDown", () => {
  it("replaces when the click is not already in the set", () => {
    expect(selectionOnItemDown([], "a", false)).toEqual(["a"]);
    expect(selectionOnItemDown(["a"], "b", false)).toEqual(["b"]);
  });

  it("keeps a multi-select so a drag can move the whole set", () => {
    expect(selectionOnItemDown(["a", "b"], "a", false)).toEqual(["a", "b"]);
  });

  it("toggles on shift", () => {
    expect(selectionOnItemDown(["a"], "b", true)).toEqual(["a", "b"]);
    expect(selectionOnItemDown(["a", "b"], "a", true)).toEqual(["b"]);
  });
});

describe("selectionOnItemClick", () => {
  it("collapses a multi-select to the clicked sprite", () => {
    expect(selectionOnItemClick(["a", "b"], "a", false)).toEqual(["a"]);
  });

  it("leaves a shift-toggle alone", () => {
    expect(selectionOnItemClick(["a", "b"], "a", true)).toEqual(["a", "b"]);
  });

  it("does not change a single selection", () => {
    expect(selectionOnItemClick(["a"], "a", false)).toEqual(["a"]);
  });
});

describe("selectionBounds", () => {
  it("is the union of sprite and repeater boxes", () => {
    expect(
      selectionBounds(
        [item({ id: "a", x: 0, y: 0, footprint: { width: 10, height: 10 } })],
        [group({ id: "g", x: 30, y: 10 })]
      )
    ).toEqual({ x: 0, y: 0, width: 94, height: 42 });
  });

  it("is null when the selection is empty", () => {
    expect(selectionBounds([], [])).toBeNull();
  });
});

describe("pointInRect", () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };

  it("includes the origin and excludes the far edge", () => {
    expect(pointInRect({ x: 0, y: 0 }, box)).toBe(true);
    expect(pointInRect({ x: 10, y: 5 }, box)).toBe(false);
    expect(pointInRect({ x: 5, y: 5 }, box)).toBe(true);
  });
});

describe("selectionOnTargetDown", () => {
  it("shift-toggles a repeater without dropping selected sprites", () => {
    expect(
      selectionOnTargetDown({ itemIds: ["a"], groupIds: [] }, "group", "g", true)
    ).toEqual({ itemIds: ["a"], groupIds: ["g"] });
    expect(
      selectionOnTargetDown({ itemIds: ["a"], groupIds: ["g"] }, "item", "a", true)
    ).toEqual({ itemIds: [], groupIds: ["g"] });
  });

  it("keeps a mixed set so a drag can move both kinds", () => {
    expect(
      selectionOnTargetDown({ itemIds: ["a"], groupIds: ["g"] }, "group", "g", false)
    ).toEqual({ itemIds: ["a"], groupIds: ["g"] });
  });
});

describe("selectionOnTargetClick", () => {
  it("collapses a mixed set to the clicked repeater", () => {
    expect(
      selectionOnTargetClick({ itemIds: ["a"], groupIds: ["g"] }, "group", "g", false)
    ).toEqual({ itemIds: [], groupIds: ["g"] });
  });
});

describe("selectionOnMarquee", () => {
  it("replaces on a plain drag and unions on shift", () => {
    expect(
      selectionOnMarquee(
        { itemIds: ["a"], groupIds: [] },
        { itemIds: ["b", "c"], groupIds: [] },
        false
      )
    ).toEqual({ itemIds: ["b", "c"], groupIds: [] });
    expect(
      selectionOnMarquee(
        { itemIds: ["a"], groupIds: [] },
        { itemIds: ["b"], groupIds: ["g"] },
        true
      )
    ).toEqual({ itemIds: ["a", "b"], groupIds: ["g"] });
  });

  it("replace tracks the current box, so shrinking drops ids", () => {
    const baseline = { itemIds: ["old"], groupIds: ["keep"] };
    expect(
      selectionOnMarquee(baseline, { itemIds: ["a", "b"], groupIds: ["g"] }, false)
    ).toEqual({ itemIds: ["a", "b"], groupIds: ["g"] });
    expect(
      selectionOnMarquee(baseline, { itemIds: ["a"], groupIds: [] }, false)
    ).toEqual({ itemIds: ["a"], groupIds: [] });
  });

  it("additive keeps the snapshot and only unions current hits", () => {
    const baseline = { itemIds: ["old"], groupIds: ["keep"] };
    expect(
      selectionOnMarquee(baseline, { itemIds: ["a", "b"], groupIds: [] }, true)
    ).toEqual({ itemIds: ["old", "a", "b"], groupIds: ["keep"] });
    expect(
      selectionOnMarquee(baseline, { itemIds: ["a"], groupIds: [] }, true)
    ).toEqual({ itemIds: ["old", "a"], groupIds: ["keep"] });
  });

  it("keeps the snapshot when an additive marquee hits nothing", () => {
    expect(
      selectionOnMarquee({ itemIds: ["a"], groupIds: ["g"] }, { itemIds: [], groupIds: [] }, true)
    ).toEqual({ itemIds: ["a"], groupIds: ["g"] });
    expect(
      selectionOnMarquee({ itemIds: ["a"], groupIds: ["g"] }, { itemIds: [], groupIds: [] }, false)
    ).toEqual({ itemIds: [], groupIds: [] });
  });
});
