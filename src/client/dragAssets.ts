const MIME = "application/x-art-studio-assets";

export function startAssetDrag(event: React.DragEvent, assetIds: string[]): void {
  if (assetIds.length === 0) return;

  event.dataTransfer.setData(MIME, JSON.stringify(assetIds));
  event.dataTransfer.setData("text/plain", assetIds.join(","));
  event.dataTransfer.effectAllowed = "copy";
}

export function isAssetDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(MIME);
}

export function readAssetDrag(event: React.DragEvent): string[] {
  const raw = event.dataTransfer.getData(MIME);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export type TemplateDrop = { kind: "file"; file: File } | { kind: "asset"; assetId: string };

export function isTemplateDrop(event: React.DragEvent): boolean {
  return isAssetDrag(event) || event.dataTransfer.types.includes("Files");
}

/**
 * Whether a drop zone should call preventDefault on dragover.
 *
 * Payload is not readable until drop — browsers empty getData during
 * dragover — so this only looks at `types`. `assetsOnly` is the starting-
 * image slot: files are refused, library assets are not.
 */
export function canAcceptTemplateDrop(types: readonly string[], assetsOnly = false): boolean {
  if (types.includes(MIME)) return true;
  return !assetsOnly && types.includes("Files");
}

export function readTemplateDrop(event: React.DragEvent): TemplateDrop | null {
  const [assetId] = readAssetDrag(event);
  if (assetId) return { kind: "asset", assetId };

  const file = [...event.dataTransfer.files].find((entry) => entry.type.startsWith("image/"));
  return file ? { kind: "file", file } : null;
}
