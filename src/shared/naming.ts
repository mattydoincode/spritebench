/**
 * Asset naming.
 *
 * An asset has two names. Its number is a fact: allocated by the server,
 * unique within the project, never reused. Its pretty name is an opinion,
 * lives in the project's Yjs document, and is optional. The number is the
 * fallback rather than a prefix, so renaming replaces `003` with `hero idle`
 * instead of producing `003_hero_idle`.
 */

/** Minimum width of the number, so a new project reads 001 rather than 1. */
const PAD = 3;

export function formatSeq(seq: number): string {
  return String(Math.max(0, Math.floor(seq))).padStart(PAD, "0");
}

/**
 * What the UI shows. Clearing a rename falls back to the number rather than
 * leaving the asset nameless, which is why this is computed and never stored.
 */
export function displayName(seq: number, prettyName?: string | null): string {
  return prettyName?.trim() || formatSeq(seq);
}

/**
 * Filename-safe, and safe to put in a ZIP central directory or an object key:
 * no slashes, no `..`, no leading dot. Lowercased so exports are consistent
 * across case-sensitive and case-insensitive filesystems.
 */
export function sanitizeName(value: string, fallback: string): string {
  const cleaned = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * The stem a download or export uses: `mygame_001.png` while unnamed,
 * `mygame_hero_idle.png` once renamed.
 *
 * The project name is sanitized every time rather than stored as a slug, so
 * renaming a project changes future exports and leaves past ones alone --
 * which is what someone renaming a project expects.
 */
export function exportStem(
  projectName: string,
  seq: number,
  prettyName?: string | null
): string {
  const project = sanitizeName(projectName, "project");
  const asset = sanitizeName(displayName(seq, prettyName), formatSeq(seq));

  return `${project}_${asset}`;
}

/**
 * A default name for a new scene that nothing else is already using.
 *
 * Starts from the count rather than from 1 so the common case is one pass, and
 * keeps walking so that deleting the middle of a list, or a collaborator
 * adding one at the same moment, still yields a name you can tell apart. These
 * are suggestions, not identities -- the document keys on the id, and two
 * scenes sharing a name is untidy rather than broken.
 */
export function nextSceneName(existing: Array<{ name: string }>): string {
  const taken = new Set(existing.map((entry) => entry.name));

  for (let n = existing.length + 1; ; n += 1) {
    const name = `scene ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * A default name for a new animation on a sheet that already has some.
 *
 * The first one is bare rather than numbered, because most sheets only hold
 * one and "animation 1" reads like there is a second somewhere.
 */
export function nextSequenceName(existing: Array<{ name: string }>): string {
  const taken = new Set(existing.map((entry) => entry.name));
  if (!taken.has("animation")) return "animation";

  for (let n = 2; ; n += 1) {
    const name = `animation ${n}`;
    if (!taken.has(name)) return name;
  }
}
