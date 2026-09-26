import type { ResolvedAsset } from "./model";

/** Enough for a big batch; older arrivals can wait until they are opened. */
export const PREFETCH_LIMIT = 32;

/**
 * Assets to warm, newest first: ones not seen before that still have a full
 * source. Marks everything it looks at as seen, so each asset is tried once.
 */
export function takeNewArrivals(
  seen: Set<string>,
  assets: ReadonlyArray<Pick<ResolvedAsset, "id" | "hasSource">>,
  limit = PREFETCH_LIMIT
): string[] {
  const fresh: string[] = [];
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    if (asset.hasSource) fresh.push(asset.id);
  }
  return fresh.slice(-limit).reverse();
}
