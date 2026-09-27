import type { AssetEdits } from "./model";

/**
 * A short hash of everything in an image's editable half that changes what a
 * Godot export renders: its processing (size, cutout, palette, crops, …) and
 * its animations (frames, speed, playback). Recorded when a slot exports, so
 * the studio can tell which slots are behind the edits made since.
 */

/** JSON with object keys sorted, so the same values always hash the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** FNV-1a, 32-bit. Collisions only cost a missed "changed" badge. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function slotExportFingerprint(
  assetIds: readonly string[],
  edits: Readonly<Record<string, Pick<AssetEdits, "processing" | "sequences"> | undefined>>
): string {
  return hash(
    stable(
      assetIds.map((id) => ({
        id,
        processing: edits[id]?.processing ?? null,
        sequences: edits[id]?.sequences ?? null
      }))
    )
  );
}
