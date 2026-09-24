/**
 * Axonometric projections used by the diamond plate, lattice, and yaw.
 *
 * `true` is real isometric: 45° yaw, arctan(1/√2) pitch, 120° axes, diamond
 * √3 wide for every 1 tall. `dimetric` is the 2:1 pixel-art convention.
 */

export const ISO_PROJECTIONS = ["true", "dimetric"] as const;
export type IsoProjection = (typeof ISO_PROJECTIONS)[number];

export const DEFAULT_ISO_PROJECTION: IsoProjection = "true";

/** Width / height of the ground diamond. */
export const ISO_DIAMOND_RATIO: Record<IsoProjection, number> = {
  true: Math.sqrt(3),
  dimetric: 2
};

export function isoDiamondHeight(width: number, projection: IsoProjection): number {
  return width / ISO_DIAMOND_RATIO[projection];
}

export function isoDiamondHeightForPitch(width: number, pitch: number): number {
  return width / isoDiamondRatioForPitch(pitch);
}

export function isoPitchesEqual(a: number, b: number): boolean {
  return Math.abs(clampIsoTemplatePitch(a) - clampIsoTemplatePitch(b)) < 0.05;
}

/** Vertical squash after a 45° square rotation. Inverse of the diamond ratio. */
export function isoSquash(projection: IsoProjection): number {
  return 1 / ISO_DIAMOND_RATIO[projection];
}

export function isoDiamondSize(projection: IsoProjection, width = 256): { width: number; height: number } {
  return { width, height: Math.max(1, Math.round(isoDiamondHeight(width, projection))) };
}

/** Camera elevation from horizontal. 30° is 2:1; `TRUE_ISO_PITCH` is √3:1. */
export const DIMETRIC_PITCH = 30;
export const TRUE_ISO_PITCH = Math.atan(1 / Math.SQRT2) * (180 / Math.PI);
export const MIN_ISO_PITCH = 8;
export const MAX_ISO_PITCH = 80;
export const MIN_ISO_TEMPLATE_PITCH = 0;
export const MAX_ISO_TEMPLATE_PITCH = 90;

export function clampIsoPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DIMETRIC_PITCH;
  return Math.min(MAX_ISO_PITCH, Math.max(MIN_ISO_PITCH, pitch));
}

export function clampIsoTemplatePitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return DIMETRIC_PITCH;
  return Math.min(MAX_ISO_TEMPLATE_PITCH, Math.max(MIN_ISO_TEMPLATE_PITCH, pitch));
}

export function isoPitchFromProjection(projection: IsoProjection): number {
  return projection === "dimetric" ? DIMETRIC_PITCH : TRUE_ISO_PITCH;
}

export function isoDiamondRatioForPitch(pitch: number): number {
  const clamped = clampIsoTemplatePitch(pitch);
  if (isoPitchesEqual(clamped, DIMETRIC_PITCH)) return ISO_DIAMOND_RATIO.dimetric;
  if (isoPitchesEqual(clamped, TRUE_ISO_PITCH)) return ISO_DIAMOND_RATIO.true;
  const sine = Math.sin((clamped * Math.PI) / 180);
  return 1 / Math.max(sine, 1e-6);
}
