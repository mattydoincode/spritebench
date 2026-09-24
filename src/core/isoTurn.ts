/**
 * Yaw on an axonometric sprite: unsquash to a 45° square, rotate, squish back.
 * Screen-space 90° would stand the diamond on its side. This keeps the
 * footprint and turns SE art to NE (then NW, then SW).
 */

import {
  DEFAULT_ISO_PROJECTION,
  ISO_DIAMOND_RATIO,
  isoSquash,
  type IsoProjection
} from "./iso";

export function clampIsoTurn(value: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(value)) return 0;
  return ((((Math.round(value) % 4) + 4) % 4) as 0 | 1 | 2 | 3);
}

function cssScale(value: number): string {
  if (value === 0.5) return "0.5";
  if (value === 2) return "2";
  return String(value);
}

/** CSS applied after flips. Empty when the sprite is as-drawn. */
export function isoTurnCss(turns: number, projection: IsoProjection = DEFAULT_ISO_PROJECTION): string {
  const n = clampIsoTurn(turns);
  if (n === 0) return "";
  return `scaleY(${cssScale(isoSquash(projection))}) rotate(${n * 90}deg) scaleY(${cssScale(ISO_DIAMOND_RATIO[projection])})`;
}

export function spriteFacingCss(
  flipHorizontal: boolean,
  flipVertical: boolean,
  isoTurn = 0,
  projection: IsoProjection = DEFAULT_ISO_PROJECTION
): string {
  const flip = `scale(${flipHorizontal ? -1 : 1}, ${flipVertical ? -1 : 1})`;
  const yaw = isoTurnCss(isoTurn, projection);
  return yaw ? `${yaw} ${flip}` : flip;
}
