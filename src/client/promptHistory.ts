import type { ProcessingSettings } from "@/core/settings";
import type { GenerationParams } from "@/shared/model";
import { useServer } from "./stores/server";
import { type ProjectDraft, useUi } from "./stores/ui";

/**
 * Undo for the generate setup: the prompt, its variables, and whatever a
 * reset or a restore replaced. Local to this browser tab, never shared.
 *
 * The textarea's own undo cannot do this: it forgets everything the moment
 * code sets its value, which is what reset, snippet inserts and autocomplete
 * all do. So the prompt keeps its own stack and the textarea routes Ctrl+Z
 * here instead.
 *
 * Each entry holds only the fields its change touched. Undoing some typing
 * does not also revert a mode toggled since; undoing a reset puts back all of
 * it, model settings included.
 */

type DraftKey = keyof ProjectDraft | "batches";

const PROMPT_KEYS: readonly DraftKey[] = ["promptBody", "variables"];
const SETUP_KEYS: readonly DraftKey[] = [
  "promptBody",
  "variables",
  "batchName",
  "animation",
  "itemGrid",
  "loop",
  "chunk",
  "each",
  "animateExpansions",
  "bases",
  "mask",
  "batches"
];

/** Keystrokes closer together than this are one undo step. */
const TYPING_GAP_MS = 1000;
const LIMIT = 100;

interface Snapshot {
  draft: Partial<ProjectDraft> & { batches?: number };
  generation?: GenerationParams;
  processing?: ProcessingSettings;
}

interface Entry {
  keys: readonly DraftKey[];
  /** Also covers the model and size settings, which live on the server store. */
  settings: boolean;
  snapshot: Snapshot;
}

let past: Entry[] = [];
let future: Entry[] = [];
let lastTyped = 0;
let project: string | null = null;

function capture(keys: readonly DraftKey[], settings: boolean): Snapshot {
  const ui = useUi.getState();
  const draft: Record<string, unknown> = {};
  for (const key of keys) draft[key] = ui[key];

  const snapshot: Snapshot = { draft: draft as Snapshot["draft"] };
  if (settings) {
    const { generation, processing } = useServer.getState().settings;
    snapshot.generation = generation;
    snapshot.processing = processing;
  }
  return snapshot;
}

function apply(snapshot: Snapshot): void {
  useUi.getState().restoreDraft(snapshot.draft);
  if (snapshot.generation) useServer.getState().setGeneration(snapshot.generation);
  if (snapshot.processing) useServer.getState().setDefaultProcessing(snapshot.processing);
}

/** A stack from another project is not this one's history. */
function sameProject(): void {
  const current = useServer.getState().project?.id ?? null;
  if (current === project) return;
  project = current;
  past = [];
  future = [];
  lastTyped = 0;
}

function push(keys: readonly DraftKey[], settings: boolean): void {
  sameProject();
  past.push({ keys, settings, snapshot: capture(keys, settings) });
  if (past.length > LIMIT) past.shift();
  future = [];
}

/**
 * Call before changing the prompt or its variables. `typing` folds a run of
 * keystrokes into the step that started it.
 */
export function recordPrompt({ typing = false }: { typing?: boolean } = {}): void {
  const now = Date.now();
  const continuing = typing && now - lastTyped < TYPING_GAP_MS;
  lastTyped = typing ? now : 0;
  if (!continuing) push(PROMPT_KEYS, false);
}

/** Call before replacing the whole setup: reset, or restore from an asset. */
export function recordSetup(): void {
  lastTyped = 0;
  push(SETUP_KEYS, true);
}

function step(from: Entry[], to: Entry[]): boolean {
  sameProject();
  const entry = from.pop();
  if (!entry) return false;

  to.push({ ...entry, snapshot: capture(entry.keys, entry.settings) });
  apply(entry.snapshot);
  lastTyped = 0;
  return true;
}

export function undoPrompt(): boolean {
  return step(past, future);
}

export function redoPrompt(): boolean {
  return step(future, past);
}
