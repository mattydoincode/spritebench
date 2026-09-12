import type { Size } from "@/core/types";

/**
 * Gemini (and anything else that bills in named buckets) does not take an
 * exact pixel size. The rest of the app still thinks in pixels -- sheets,
 * templates, the size fields -- so this module is the translation: pick the
 * nearest legal ratio and bucket, then report the pixel size that implies.
 *
 * Client-safe: no Node built-ins.
 */

export const RATIO_ASPECTS = [
  { id: "1:1", width: 1, height: 1 },
  { id: "3:2", width: 3, height: 2 },
  { id: "2:3", width: 2, height: 3 },
  { id: "4:3", width: 4, height: 3 },
  { id: "3:4", width: 3, height: 4 },
  { id: "5:4", width: 5, height: 4 },
  { id: "4:5", width: 4, height: 5 },
  { id: "16:9", width: 16, height: 9 },
  { id: "9:16", width: 9, height: 16 },
  { id: "21:9", width: 21, height: 9 },
  { id: "9:21", width: 9, height: 21 },
  { id: "4:1", width: 4, height: 1 },
  { id: "1:4", width: 1, height: 4 },
  { id: "8:1", width: 8, height: 1 },
  { id: "1:8", width: 1, height: 8 }
] as const;

export type RatioImageSize = "1K" | "2K" | "4K";

export const RATIO_IMAGE_SIZES: readonly { id: RatioImageSize; longEdge: number }[] = [
  { id: "1K", longEdge: 1024 },
  { id: "2K", longEdge: 2048 },
  { id: "4K", longEdge: 4096 }
];

export interface RatioRequest {
  aspectRatio: string;
  imageSize: RatioImageSize;
  size: Size;
}

function pixelsFor(aspect: (typeof RATIO_ASPECTS)[number], longEdge: number): Size {
  if (aspect.width >= aspect.height) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round((longEdge * aspect.height) / aspect.width))
    };
  }

  return {
    width: Math.max(1, Math.round((longEdge * aspect.width) / aspect.height)),
    height: longEdge
  };
}

function nearestAspect(requested: Size): (typeof RATIO_ASPECTS)[number] {
  const wanted = Math.log(Math.max(1, requested.width) / Math.max(1, requested.height));

  let best: (typeof RATIO_ASPECTS)[number] = RATIO_ASPECTS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of RATIO_ASPECTS) {
    const distance = Math.abs(Math.log(candidate.width / candidate.height) - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function nearestBucket(requested: Size): (typeof RATIO_IMAGE_SIZES)[number] {
  const longEdge = Math.max(1, requested.width, requested.height);

  let best: (typeof RATIO_IMAGE_SIZES)[number] = RATIO_IMAGE_SIZES[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of RATIO_IMAGE_SIZES) {
    const distance = Math.abs(Math.log(candidate.longEdge) - Math.log(longEdge));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

/** Nearest aspect + bucket, and the pixel size that pair produces. */
export function snapRatioRequest(requested: Size): RatioRequest {
  const size = {
    width: Math.max(1, Math.round(requested.width)),
    height: Math.max(1, Math.round(requested.height))
  };
  const aspect = nearestAspect(size);
  const bucket = nearestBucket(size);

  return {
    aspectRatio: aspect.id,
    imageSize: bucket.id,
    size: pixelsFor(aspect, bucket.longEdge)
  };
}

export function snapRatioSize(requested: Size): Size {
  return snapRatioRequest(requested).size;
}
