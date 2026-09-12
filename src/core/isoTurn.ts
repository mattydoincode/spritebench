/**
 * Yaw on a 2:1 dimetric sprite: unsquash to a 45° square, rotate, squish back.
 * Screen-space 90° would stand the diamond on its side. This keeps the
 * footprint and turns SE art to NE (then NW, then SW).
 */

export function clampIsoTurn(value: number): 0 | 1 | 2 | 3 {
  if (!Number.isFinite(value)) return 0;
  return ((((Math.round(value) % 4) + 4) % 4) as 0 | 1 | 2 | 3);
}

/** CSS applied after flips. Empty when the sprite is as-drawn. */
export function isoTurnCss(turns: number): string {
  const n = clampIsoTurn(turns);
  if (n === 0) return "";
  return `scaleY(0.5) rotate(${n * 90}deg) scaleY(2)`;
}

export function spriteFacingCss(
  flipHorizontal: boolean,
  flipVertical: boolean,
  isoTurn = 0
): string {
  const flip = `scale(${flipHorizontal ? -1 : 1}, ${flipVertical ? -1 : 1})`;
  const yaw = isoTurnCss(isoTurn);
  return yaw ? `${yaw} ${flip}` : flip;
}
