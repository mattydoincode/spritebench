/**
 * Storage key layout. Every key is a forward-slash path relative to the bucket
 * root. Keys stay flat and predictable so a driver swap is a no-op.
 */

export const SOURCES = "sources";
export const THUMBS = "thumbs";
export const TEMPLATES = "templates";
export const PALETTES = "palettes";
export const EXPORTS = "exports";

export function sourceKey(file: string): string {
  return `${SOURCES}/${file}`;
}

export function thumbKey(assetId: string): string {
  return `${THUMBS}/${assetId}.webp`;
}

export function templateKey(file: string): string {
  return `${TEMPLATES}/${file}`;
}

export function paletteKey(file: string): string {
  return `${PALETTES}/${file}`;
}

export function exportKey(folder: string, file: string): string {
  return folder.length > 0 ? `${EXPORTS}/${folder}/${file}` : `${EXPORTS}/${file}`;
}

export function basename(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}

/** Appends `_2`, `_3`, ... until `taken` reports the key as free. */
export async function uniqueKey(
  key: string,
  taken: (candidate: string) => Promise<boolean>
): Promise<string> {
  if (!(await taken(key))) return key;

  const slash = key.lastIndexOf("/");
  const dir = slash >= 0 ? key.slice(0, slash + 1) : "";
  const name = key.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";

  for (let counter = 2; counter < 10_000; counter++) {
    const candidate = `${dir}${stem}_${counter}${extension}`;
    if (!(await taken(candidate))) return candidate;
  }

  throw new Error(`could not find a free key for ${key}`);
}
