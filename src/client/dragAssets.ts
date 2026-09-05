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
