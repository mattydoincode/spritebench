import type { DragEvent } from "react";
import { describe, expect, it } from "vitest";
import { isTemplateDrop, readTemplateDrop } from "@/client/dragAssets";
import { cropImage } from "@/core/edits";
import { createImage } from "@/core/pixels";
import type { RgbaImage } from "@/core/types";
import { decodePng } from "@/server/png";
import { buildEditFromImages, jobUsesEdit } from "@/server/template";
import { DEFAULT_GENERATION, jobUsesMask, type JobInputs } from "@/shared/model";

const ASSET_MIME = "application/x-art-studio-assets";

const REFERENCE: JobInputs = {
  base: {
    source: { kind: "template", templateId: "t1" },
    fit: "contain",
    matchAspect: true
  }
};

function dragEvent(init: { types?: string[]; payload?: string; files?: File[] }): DragEvent {
  return {
    dataTransfer: {
      types: init.types ?? [],
      getData: (type: string) => (type === ASSET_MIME ? (init.payload ?? "") : ""),
      files: init.files ?? []
    }
  } as unknown as DragEvent;
}

describe("jobUsesEdit", () => {
  it("sends any attached image through images/edits, including unmasked", () => {
    expect(jobUsesEdit({ inputs: REFERENCE, sequencePlan: null })).toBe(true);
    expect(jobUsesEdit({ inputs: null, sequencePlan: null })).toBe(false);
  });

  it("treats a loop or chunk request as an edit even before the start is attached", () => {
    expect(jobUsesEdit({ inputs: { loop: { steps: 3 } }, sequencePlan: null })).toBe(true);
    expect(jobUsesEdit({ inputs: { chunk: { columns: 2, rows: 2 } }, sequencePlan: null })).toBe(true);
    expect(jobUsesMask({ inputs: { loop: { steps: 3 } }, sequencePlan: null })).toBe(false);
    expect(
      jobUsesMask({
        inputs: {
          mask: {
            source: { kind: "template", templateId: "t1" },
            maskSource: "keepInsideShape",
            dilatePixels: 0,
            fit: "contain"
          }
        }
      })
    ).toBe(true);
  });

  it("also edits when an animation sheet has unused cells to mask", () => {
    expect(
      jobUsesEdit({
        inputs: null,
        sequencePlan: { columns: 4, rows: 1, fps: 8, actions: [{ name: "walk", frames: 3 }] }
      })
    ).toBe(true);
    expect(jobUsesEdit({ inputs: null, sequencePlan: { columns: 1, rows: 1, fps: 8, actions: [] } })).toBe(
      false
    );
  });
});

function paint(width: number, height: number): RgbaImage {
  const image = createImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      image.data[i] = x % 256;
      image.data[i + 1] = y % 256;
      image.data[i + 2] = 80;
      image.data[i + 3] = 255;
    }
  }
  return image;
}

describe("buildEditFromImages", () => {
  it("uses the mask image as the base when nothing else is attached", () => {
    const mask = paint(32, 32);
    const result = buildEditFromImages(null, mask, {
      mask: {
        source: { kind: "template", templateId: "t1" },
        maskSource: "keepOutsideShape",
        dilatePixels: 0,
        fit: "contain"
      }
    }, DEFAULT_GENERATION);

    expect(result.mask).not.toBeNull();
    expect(result.size.width).toBeGreaterThan(0);
    expect(decodePng(Buffer.from(result.base)).width).toBe(result.size.width);
  });

  it("crops a chunk cell before conforming", () => {
    const origin = paint(64, 64);
    const cell = cropImage(origin, { kind: "crop", x: 32, y: 32, width: 32, height: 32 });
    expect(cell.data[0]).toBe(32);
    expect(cell.data[1]).toBe(32);

    const result = buildEditFromImages(
      cell,
      null,
      {
        base: {
          source: { kind: "asset", assetId: "11111111-1111-1111-1111-111111111111" },
          fit: "contain",
          matchAspect: true
        },
        chunk: { columns: 2, rows: 2, index: 3, rect: { x: 32, y: 32, width: 32, height: 32 } }
      },
      { ...DEFAULT_GENERATION, size: { width: 32, height: 32 } }
    );

    expect(result.mask).toBeNull();
    expect(result.size.width).toBeGreaterThan(0);
  });
});

describe("template drop", () => {
  it("prefers a dragged asset over a file", () => {
    const event = dragEvent({
      types: [ASSET_MIME, "Files"],
      payload: JSON.stringify(["asset-1"]),
      files: [new File(["x"], "sketch.png", { type: "image/png" })]
    });

    expect(isTemplateDrop(event)).toBe(true);
    expect(readTemplateDrop(event)).toEqual({ kind: "asset", assetId: "asset-1" });
  });

  it("accepts an image file when no asset is on the drag", () => {
    const file = new File(["x"], "sketch.png", { type: "image/png" });
    const event = dragEvent({ types: ["Files"], files: [file] });

    expect(readTemplateDrop(event)).toEqual({ kind: "file", file });
  });

  it("ignores non-image files", () => {
    const event = dragEvent({
      types: ["Files"],
      files: [new File(["x"], "notes.txt", { type: "text/plain" })]
    });

    expect(readTemplateDrop(event)).toBeNull();
  });
});
