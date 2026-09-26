/**
 * `@name` in a prompt stands for a project snippet's text.
 *
 * Expansion is one level: a snippet's own `@refs` stay literal, so what a
 * prompt pulls in is always visible from the prompt itself. `{variables}`
 * inside a snippet are fine -- they are filled after snippets, like any other.
 *
 * Not preceded by a word character, so an email address is not a snippet.
 */
export const SNIPPET_PATTERN = /(?<![A-Za-z0-9_.])@([A-Za-z_][A-Za-z0-9_]*)/g;

interface NamedText {
  name: string;
  text: string;
}

/** Names referenced in `text`, first appearance first. */
export function snippetRefs(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(SNIPPET_PATTERN)) seen.add(match[1]);
  return [...seen];
}

/** A typed name made usable after `@`: spaces and symbols become `_`. */
export function cleanSnippetName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function byName(snippets: readonly NamedText[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of snippets) if (!map.has(entry.name)) map.set(entry.name, entry.text);
  return map;
}

/** Unknown names stay as written. */
export function expandSnippets(text: string, snippets: readonly NamedText[]): string {
  const known = byName(snippets);
  return text.replace(SNIPPET_PATTERN, (whole, name: string) => known.get(name) ?? whole);
}

export interface PromptSegment {
  text: string;
  /** Set when this segment is a snippet's text. */
  snippet?: string;
}

/** `text` split into plain runs and expanded snippets, for showing which is which. */
export function snippetSegments(text: string, snippets: readonly NamedText[]): PromptSegment[] {
  const known = byName(snippets);
  const segments: PromptSegment[] = [];
  let at = 0;

  for (const match of text.matchAll(SNIPPET_PATTERN)) {
    const value = known.get(match[1]);
    if (value === undefined) continue;
    if (match.index > at) segments.push({ text: text.slice(at, match.index) });
    segments.push({ text: value, snippet: match[1] });
    at = match.index + match[0].length;
  }

  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

/** Puts `token` at `at`, with a space either side where it would touch a word. */
export function insertAt(text: string, at: number, token: string): { text: string; caret: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${token}${trail}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + lead.length + token.length };
}
