import { describe, expect, it } from "vitest";
import {
  buildBayerMatrix,
  findNearest,
  parseGimpPalette,
  parseHexList,
  parseJascPalette,
  parsePaletteText,
  quantize,
  uniqueOpaqueColors
} from "@/core/palette";
import { createImage } from "@/core/pixels";
import type { Rgb } from "@/core/types";
import { solid } from "./helpers";

describe("parseHexList (.hex / .txt)", () => {
  it("reads bare six-digit hex, one per line", () => {
    expect(parseHexList("ff0000\n00ff00\n0000ff")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }
    ]);
  });

  it("tolerates a leading hash", () => {
    expect(parseHexList("#ff0000\n#00ff00")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 }
    ]);
  });

  it("is case insensitive", () => {
    expect(parseHexList("AaBbCc")).toEqual([{ r: 170, g: 187, b: 204 }]);
  });

  it("takes only the first token on a line with trailing commentary", () => {
    expect(parseHexList("ff0000 red\n00ff00,green\n0000ff;blue")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }
    ]);
  });

  it("skips blank lines and short comment lines", () => {
    expect(parseHexList("\n\n#\nff0000\n\n   \n00ff00\n")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 }
    ]);
  });

  it("drops entries that are not valid hex", () => {
    expect(parseHexList("ff00\nzzzzzz\nff0000\n1234567")).toEqual([{ r: 255, g: 0, b: 0 }]);
  });

  it("keeps eight-digit hex when alpha is at least half", () => {
    expect(parseHexList("ff0000ff\n00ff0080")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 }
    ]);
  });

  it("drops eight-digit hex that is mostly transparent", () => {
    expect(parseHexList("ff000000\n00ff0010")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(parseHexList("ff0000\r\n00ff00\r\n")).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 }
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseHexList("")).toEqual([]);
  });
});

describe("parseGimpPalette (.gpl)", () => {
  const sample = [
    "GIMP Palette",
    "Name: Test",
    "Columns: 4",
    "#",
    "255   0   0  red",
    "  0 255   0  green",
    "  0   0 255  blue"
  ].join("\n");

  it("reads the colour rows and skips the header", () => {
    expect(parseGimpPalette(sample)).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }
    ]);
  });

  it("skips comment lines", () => {
    expect(parseGimpPalette("GIMP Palette\n# a comment\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("drops rows with fewer than three components", () => {
    expect(parseGimpPalette("GIMP Palette\n255 0\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("drops rows with non-numeric components", () => {
    expect(parseGimpPalette("GIMP Palette\nred green blue\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("returns empty for a header-only file", () => {
    expect(parseGimpPalette("GIMP Palette\nName: Empty\nColumns: 0\n#")).toEqual([]);
  });
});

describe("parseJascPalette (.pal)", () => {
  const sample = ["JASC-PAL", "0100", "3", "255 0 0", "0 255 0", "0 0 255"].join("\n");

  it("skips the three header lines", () => {
    expect(parseJascPalette(sample)).toEqual([
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 }
    ]);
  });

  it("returns empty when there are no rows after the header", () => {
    expect(parseJascPalette("JASC-PAL\n0100\n0")).toEqual([]);
  });

  it("drops malformed rows", () => {
    expect(parseJascPalette("JASC-PAL\n0100\n2\n1 2 3\nbad row here")).toEqual([
      { r: 1, g: 2, b: 3 }
    ]);
  });

  it("handles CRLF", () => {
    expect(parseJascPalette("JASC-PAL\r\n0100\r\n1\r\n7 8 9\r\n")).toEqual([{ r: 7, g: 8, b: 9 }]);
  });
});

describe("parsePaletteText dispatch", () => {
  it("routes .gpl to the GIMP parser", () => {
    expect(parsePaletteText("x.gpl", "GIMP Palette\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("routes .pal to the JASC parser", () => {
    expect(parsePaletteText("x.pal", "JASC-PAL\n0100\n1\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("routes .hex and .txt to the hex parser", () => {
    expect(parsePaletteText("x.hex", "ff0000")).toEqual([{ r: 255, g: 0, b: 0 }]);
    expect(parsePaletteText("x.txt", "ff0000")).toEqual([{ r: 255, g: 0, b: 0 }]);
  });

  it("is case insensitive on the extension", () => {
    expect(parsePaletteText("X.GPL", "GIMP Palette\n1 2 3")).toEqual([{ r: 1, g: 2, b: 3 }]);
  });

  it("falls back to the hex parser for an unknown extension", () => {
    expect(parsePaletteText("noextension", "ff0000")).toEqual([{ r: 255, g: 0, b: 0 }]);
  });
});

describe("uniqueOpaqueColors (.png palettes)", () => {
  it("deduplicates repeated colours", () => {
    expect(uniqueOpaqueColors(solid(8, 8, { r: 10, g: 20, b: 30 }))).toEqual([
      { r: 10, g: 20, b: 30 }
    ]);
  });

  it("preserves first-seen order", () => {
    const image = createImage(3, 1);
    const colors = [
      { r: 3, g: 3, b: 3 },
      { r: 1, g: 1, b: 1 },
      { r: 2, g: 2, b: 2 }
    ];

    colors.forEach((color, index) => {
      const i = index * 4;
      image.data[i] = color.r;
      image.data[i + 1] = color.g;
      image.data[i + 2] = color.b;
      image.data[i + 3] = 255;
    });

    expect(uniqueOpaqueColors(image)).toEqual(colors);
  });

  it("ignores pixels below half alpha", () => {
    expect(uniqueOpaqueColors(solid(4, 4, { r: 9, g: 9, b: 9 }, 127))).toEqual([]);
    expect(uniqueOpaqueColors(solid(4, 4, { r: 9, g: 9, b: 9 }, 128))).toEqual([
      { r: 9, g: 9, b: 9 }
    ]);
  });

  it("returns empty for a fully transparent image", () => {
    expect(uniqueOpaqueColors(createImage(16, 16))).toEqual([]);
  });
});

describe("findNearest", () => {
  const palette: Rgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 },
    { r: 255, g: 0, b: 0 }
  ];

  // "rgb" mode stores each channel divided by 255, so the space is easy to build by hand.
  const rgbSpace = Float64Array.from(palette.flatMap((c) => [c.r / 255, c.g / 255, c.b / 255]));

  it("returns the index of an exact match", () => {
    expect(findNearest(0, 0, 0, rgbSpace, "rgb")).toBe(0);
    expect(findNearest(255, 255, 255, rgbSpace, "rgb")).toBe(1);
    expect(findNearest(255, 0, 0, rgbSpace, "rgb")).toBe(2);
  });

  it("returns the closest entry for a colour that is not in the palette", () => {
    expect(findNearest(10, 10, 10, rgbSpace, "rgb")).toBe(0);
    expect(findNearest(240, 240, 240, rgbSpace, "rgb")).toBe(1);
    expect(findNearest(200, 20, 20, rgbSpace, "rgb")).toBe(2);
  });

  it("picks the first entry on an exact tie", () => {
    const tied = Float64Array.from([0, 0, 0, 0, 0, 0]);
    expect(findNearest(128, 128, 128, tied, "rgb")).toBe(0);
  });

  it("finds an exact match through quantize in every distance mode", () => {
    for (const mode of ["rgb", "weightedRgb", "oklab"] as const) {
      const result = quantize(solid(1, 1, palette[2]), palette, mode, "none", 1, 0.5);
      expect({ r: result.data[0], g: result.data[1], b: result.data[2] }).toEqual(palette[2]);
    }
  });
});

describe("quantize", () => {
  const palette: Rgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 255, g: 255, b: 255 }
  ];

  it("returns the input untouched for an empty palette", () => {
    const image = solid(4, 4, { r: 12, g: 34, b: 56 });
    expect(quantize(image, [], "oklab", "none", 1, 0.5)).toBe(image);
  });

  it("maps every opaque pixel into the palette", () => {
    const result = quantize(solid(8, 8, { r: 200, g: 200, b: 200 }), palette, "oklab", "none", 1, 0.5);

    for (let pixel = 0; pixel < 64; pixel++) {
      const i = pixel * 4;
      const color = { r: result.data[i], g: result.data[i + 1], b: result.data[i + 2] };
      expect(palette).toContainEqual(color);
    }
  });

  it("leaves transparent pixels alone", () => {
    const image = solid(4, 4, { r: 200, g: 100, b: 50 }, 0);
    const result = quantize(image, palette, "oklab", "none", 1, 0.5);

    expect(result.data[0]).toBe(200);
    expect(result.data[1]).toBe(100);
    expect(result.data[2]).toBe(50);
  });

  it("does not mutate the input", () => {
    const image = solid(4, 4, { r: 200, g: 200, b: 200 });
    const before = Uint8Array.from(image.data);

    quantize(image, palette, "oklab", "floydSteinberg", 1, 0.5);

    expect(Uint8Array.from(image.data)).toEqual(before);
  });

  it("produces a mix of palette entries when dithering a mid grey", () => {
    const result = quantize(
      solid(16, 16, { r: 128, g: 128, b: 128 }),
      palette,
      "rgb",
      "bayer4x4",
      1,
      0.5
    );

    const seen = new Set<number>();
    for (let pixel = 0; pixel < 256; pixel++) seen.add(result.data[pixel * 4]);

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("buildBayerMatrix", () => {
  it("builds 2x2, 4x4 and 8x8 matrices", () => {
    expect(buildBayerMatrix(2).length).toBe(2);
    expect(buildBayerMatrix(4).length).toBe(4);
    expect(buildBayerMatrix(8).length).toBe(8);
  });

  it("uses every value in the range exactly once", () => {
    for (const size of [2, 4, 8]) {
      const values = buildBayerMatrix(size).flat().sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: size * size }, (_, i) => i));
    }
  });
});
