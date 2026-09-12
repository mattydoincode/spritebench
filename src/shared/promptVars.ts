import { composePrompt, isLoopSpec, type JobInputs, type PromptSpec } from "./model";

/**
 * Prompt slots like `{color}` and the cartesian fan-out they produce.
 *
 * A slot with no matching row stays literal. A row that is used in the text
 * but has no values blocks Create — that is an unfinished list, not a
 * one-shot. Extra rows that never appear in the text do not multiply.
 */

export const SLOT_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Filled from the loop job, not from a values row. */
export const LOOP_SLOT_NAMES = ["step", "total_steps"] as const;

export function loopReservedSlots(enabled: boolean): string[] {
  return enabled ? [...LOOP_SLOT_NAMES] : [];
}

export function loopBindings(loop: { steps: number; index: number } | null | undefined): PromptBinding {
  if (!loop) return {};
  return {
    step: String(loop.index),
    total_steps: String(loop.steps)
  };
}

export interface PromptVariable {
  name: string;
  /** Comma-separated, as typed. */
  values: string;
}

export interface PromptBinding {
  [name: string]: string;
}

export interface PromptExpansion {
  prompt: PromptSpec;
  bindings: PromptBinding;
  /** Job label: the binding values, then a slice of the body. */
  label: string;
}

/** Matches the default `MAX_IMAGES_PER_REQUEST`. The server still reads env. */
export const DEFAULT_CREATE_IMAGE_LIMIT = 40;

export function parseValues(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function collectSlots(...parts: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of parts) {
    SLOT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SLOT_PATTERN.exec(part))) {
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

export function slotsInPrompt(prompt: PromptSpec): string[] {
  return collectSlots(prompt.guide ?? "", prompt.prefix, prompt.body, prompt.extra ?? "", prompt.suffix);
}

function replaceSlots(text: string, bindings: PromptBinding): string {
  return text.replace(SLOT_PATTERN, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name] : whole
  );
}

export function bindPrompt(prompt: PromptSpec, bindings: PromptBinding): PromptSpec {
  return {
    guide: prompt.guide !== undefined ? replaceSlots(prompt.guide, bindings) : undefined,
    prefix: replaceSlots(prompt.prefix, bindings),
    body: replaceSlots(prompt.body, bindings),
    extra: prompt.extra !== undefined ? replaceSlots(prompt.extra, bindings) : undefined,
    suffix: replaceSlots(prompt.suffix, bindings)
  };
}

/** Leave `{step}` literal until a concrete loop row binds it. */
export function promptForJob(prompt: PromptSpec, inputs: JobInputs | null | undefined): PromptSpec {
  return isLoopSpec(inputs?.loop) ? bindPrompt(prompt, loopBindings(inputs.loop)) : prompt;
}

function cartesian(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((combos, values) => {
    if (combos.length === 0) return values.map((value) => [value]);
    return combos.flatMap((combo) => values.map((value) => [...combo, value]));
  }, []);
}

/**
 * Rows that actually multiply this prompt, in definition order.
 *
 * First listed varies slowest: `{color}` × `{size}` with color first yields
 * green/small, green/large, red/small, red/large.
 */
export function activeVariables(
  prompt: PromptSpec,
  variables: PromptVariable[],
  reserved: readonly string[] = []
): PromptVariable[] {
  const used = new Set(slotsInPrompt(prompt));
  const skip = new Set(reserved);
  return variables.filter((entry) => used.has(entry.name) && !skip.has(entry.name));
}

export function expansionLabel(bindings: PromptBinding, body: string): string {
  const bound = Object.values(bindings).join(" · ");
  const text = body.trim().slice(0, 60) || "untitled";
  return bound ? `${bound} · ${text}` : text;
}

export function expandPrompt(
  prompt: PromptSpec,
  variables: PromptVariable[],
  reserved: readonly string[] = []
): PromptExpansion[] {
  const active = activeVariables(prompt, variables, reserved);
  if (active.length === 0) {
    return [{ prompt, bindings: {}, label: expansionLabel({}, prompt.body) }];
  }

  const lists = active.map((entry) => parseValues(entry.values));
  if (lists.some((list) => list.length === 0)) return [];

  return cartesian(lists).map((combo) => {
    const bindings: PromptBinding = {};
    for (const [index, entry] of active.entries()) bindings[entry.name] = combo[index];

    const next = bindPrompt(prompt, bindings);
    return {
      prompt: next,
      bindings,
      label: expansionLabel(bindings, next.body)
    };
  });
}

export interface CreatePlan {
  expansions: number;
  jobs: number;
  images: number;
  breakdown: string;
  /** Null when Create is allowed. */
  blocked: string | null;
}

function plural(count: number, name: string): string {
  if (count === 1) return `1 ${name}`;
  if (name === "batch") return `${count} batches`;
  const stem = name.endsWith("s") ? name : `${name}s`;
  return `${count} ${stem}`;
}

export function planCreate(input: {
  prompt: PromptSpec;
  variables: PromptVariable[];
  batches: number;
  imageCount: number;
  sheet: boolean;
  loopSteps?: number;
  chunkCells?: number;
  requiresStart?: boolean;
  hasStart?: boolean;
  limit?: number;
  reserved?: readonly string[];
}): CreatePlan {
  const batches = Math.max(1, Math.floor(input.batches));
  const loopSteps = Math.max(0, Math.floor(input.loopSteps ?? 0));
  const chunkCells = Math.max(0, Math.floor(input.chunkCells ?? 0));
  const fan = loopSteps > 0 ? loopSteps : chunkCells > 0 ? chunkCells : 1;
  const perJob = input.sheet || fan > 1 ? 1 : Math.max(1, Math.floor(input.imageCount));
  const reserved = input.reserved ?? [];
  const expansions = expandPrompt(input.prompt, input.variables, reserved);
  const count = expansions.length;
  const jobs = count * batches * fan;
  const images = jobs * perJob;
  const limit = input.limit ?? DEFAULT_CREATE_IMAGE_LIMIT;

  const parts: string[] = [];
  for (const entry of activeVariables(input.prompt, input.variables, reserved)) {
    const n = parseValues(entry.values).length;
    if (n > 0) parts.push(plural(n, entry.name));
  }
  if (batches > 1) parts.push(plural(batches, "batch"));
  if (loopSteps > 1) parts.push(plural(loopSteps, "step"));
  if (chunkCells > 1) parts.push(plural(chunkCells, "chunk"));
  if (perJob > 1) parts.push(plural(perJob, "image"));

  let blocked: string | null = null;
  if (input.requiresStart && !input.hasStart) {
    blocked = "pick a starting image first";
  } else if (count === 0) {
    blocked = "give every {slot} in the prompt at least one value";
  } else if (images > limit) {
    blocked = `that would generate ${images} images; the limit is ${limit} per request`;
  } else if (composePrompt(input.prompt).trim().length === 0 && count <= 1) {
    blocked = "write a prompt first";
  }

  return {
    expansions: count,
    jobs,
    images,
    breakdown: parts.join(" × "),
    blocked
  };
}

/** Rows the UI should show: saved variables plus a blank row for each new slot. */
export function offeredVariables(
  prompt: PromptSpec,
  variables: PromptVariable[],
  reserved: readonly string[] = []
): PromptVariable[] {
  const have = new Set(variables.map((entry) => entry.name));
  const skip = new Set(reserved);
  const extra = slotsInPrompt(prompt)
    .filter((name) => !have.has(name) && !skip.has(name))
    .map((name) => ({ name, values: "" }));

  return [...variables, ...extra];
}

export function nextVariableName(existing: PromptVariable[]): string {
  const have = new Set(existing.map((entry) => entry.name));
  if (!have.has("var")) return "var";

  let n = 2;
  while (have.has(`var${n}`)) n += 1;
  return `var${n}`;
}

export function insertSlot(body: string, name: string): string {
  const token = `{${name}}`;
  if (body.includes(token)) return body;
  const trimmed = body.trimEnd();
  return trimmed.length > 0 ? `${trimmed} ${token}` : token;
}
