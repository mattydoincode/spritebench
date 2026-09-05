import type { RgbaImage, Size } from "./types";

export interface CropEdit {
  kind: "crop";
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageEdit = CropEdit;

export function cropImage(image: RgbaImage, rect: CropEdit): RgbaImage {
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const originX = Math.round(rect.x);
  const originY = Math.round(rect.y);

  const data = new Uint8ClampedArray(width * height * 4);

  for (let row = 0; row < height; row++) {
    const sourceRow = originY + row;
    if (sourceRow < 0 || sourceRow >= image.height) continue;

    for (let column = 0; column < width; column++) {
      const sourceColumn = originX + column;
      if (sourceColumn < 0 || sourceColumn >= image.width) continue;

      const from = (sourceRow * image.width + sourceColumn) * 4;
      const to = (row * width + column) * 4;

      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }

  return { width, height, data };
}

export function applyEdits(image: RgbaImage, edits: ImageEdit[]): RgbaImage {
  let working = image;

  for (const edit of edits) {
    if (edit.kind === "crop") working = cropImage(working, edit);
  }

  return working;
}

export function describeEdit(edit: ImageEdit): string {
  return `crop ${Math.round(edit.width)}x${Math.round(edit.height)} at ${Math.round(
    edit.x
  )},${Math.round(edit.y)}`;
}

export function describeEdits(edits: ImageEdit[]): string {
  return edits.map(describeEdit).join(" \u2192 ");
}

export function editedSize(size: Size, edits: ImageEdit[]): Size {
  return edits.reduce(
    (current, edit) =>
      edit.kind === "crop"
        ? { width: Math.max(1, Math.round(edit.width)), height: Math.max(1, Math.round(edit.height)) }
        : current,
    size
  );
}

export function normalizeEdits(value: unknown): ImageEdit[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): ImageEdit[] => {
    if (!entry || typeof entry !== "object") return [];

    const candidate = entry as Partial<CropEdit>;
    if (candidate.kind !== "crop") return [];

    const width = Math.round(Number(candidate.width));
    const height = Math.round(Number(candidate.height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return [];

    const x = Math.round(Number(candidate.x));
    const y = Math.round(Number(candidate.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];

    return [{ kind: "crop", x, y, width, height }];
  });
}
