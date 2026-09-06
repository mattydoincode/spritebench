import type { Size } from "./types";

export const EDGE_MULTIPLE = 16;
export const MAX_EDGE = 3840;
export const MAX_ASPECT = 3;
export const MIN_TOTAL_PIXELS = 655360;
export const MAX_TOTAL_PIXELS = 8294400;
export const EXPERIMENTAL_TOTAL_PIXELS = 3686400;

export const LEGACY_SIZES: Size[] = [
  { width: 1024, height: 1024 },
  { width: 1024, height: 1536 },
  { width: 1536, height: 1024 }
];

function ceilToMultiple(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function clampAspect(size: Size): Size {
  let { width, height } = size;

  if (width > height * MAX_ASPECT) width = Math.round(height * MAX_ASPECT);
  if (height > width * MAX_ASPECT) height = Math.round(width * MAX_ASPECT);

  return { width, height };
}

export function isValidFlexibleSize({ width, height }: Size): boolean {
  if (width <= 0 || height <= 0) return false;
  if (width % EDGE_MULTIPLE !== 0 || height % EDGE_MULTIPLE !== 0) return false;
  if (width > MAX_EDGE || height > MAX_EDGE) return false;

  const total = width * height;
  if (total < MIN_TOTAL_PIXELS || total > MAX_TOTAL_PIXELS) return false;

  const longest = Math.max(width, height);
  const shortest = Math.min(width, height);
  return longest <= shortest * MAX_ASPECT;
}

function correct(size: Size): Size {
  let { width, height } = size;

  for (let pass = 0; pass < 512; pass++) {
    width = Math.min(MAX_EDGE, Math.max(EDGE_MULTIPLE, width));
    height = Math.min(MAX_EDGE, Math.max(EDGE_MULTIPLE, height));

    const clamped = clampAspect({ width, height });
    width = ceilToMultiple(clamped.width, EDGE_MULTIPLE);
    height = ceilToMultiple(clamped.height, EDGE_MULTIPLE);
    width = Math.min(MAX_EDGE, width);
    height = Math.min(MAX_EDGE, height);

    const total = width * height;

    if (total < MIN_TOTAL_PIXELS) {
      if (width <= height && width + EDGE_MULTIPLE <= MAX_EDGE) width += EDGE_MULTIPLE;
      else if (height + EDGE_MULTIPLE <= MAX_EDGE) height += EDGE_MULTIPLE;
      else if (width + EDGE_MULTIPLE <= MAX_EDGE) width += EDGE_MULTIPLE;
      else break;
      continue;
    }

    if (total > MAX_TOTAL_PIXELS) {
      if (width >= height && width - EDGE_MULTIPLE >= EDGE_MULTIPLE) width -= EDGE_MULTIPLE;
      else if (height - EDGE_MULTIPLE >= EDGE_MULTIPLE) height -= EDGE_MULTIPLE;
      else break;
      continue;
    }

    const longest = Math.max(width, height);
    const shortest = Math.min(width, height);
    if (longest > shortest * MAX_ASPECT) {
      if (width === longest) width -= EDGE_MULTIPLE;
      else height -= EDGE_MULTIPLE;
      continue;
    }

    break;
  }

  return { width, height };
}

export function snapFlexibleSize(requested: Size): Size {
  let width = Math.max(1, Math.round(requested.width));
  let height = Math.max(1, Math.round(requested.height));

  ({ width, height } = clampAspect({ width, height }));

  const total = width * height;
  if (total < MIN_TOTAL_PIXELS) {
    const scale = Math.sqrt(MIN_TOTAL_PIXELS / total);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  } else if (total > MAX_TOTAL_PIXELS) {
    const scale = Math.sqrt(MAX_TOTAL_PIXELS / total);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const longest = Math.max(width, height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return correct({
    width: ceilToMultiple(width, EDGE_MULTIPLE),
    height: ceilToMultiple(height, EDGE_MULTIPLE)
  });
}

export function snapLegacySize(requested: Size): Size {
  const wanted = Math.log(Math.max(1, requested.width) / Math.max(1, requested.height));

  let best = LEGACY_SIZES[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of LEGACY_SIZES) {
    const distance = Math.abs(Math.log(candidate.width / candidate.height) - wanted);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

export function fitToAspect(template: Size, budget: Size): Size {
  const aspect = Math.max(0.0001, template.width / Math.max(1, template.height));
  const total = Math.max(1, budget.width * budget.height);
  const height = Math.sqrt(total / aspect);

  return {
    width: Math.max(1, Math.round(height * aspect)),
    height: Math.max(1, Math.round(height))
  };
}
