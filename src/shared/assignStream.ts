import type { EngineSlotRecord } from "./engineSlot";

export const ASSIGN_STREAM_TYPE = "application/x-ndjson";

export type AssignStreamEvent =
  | { type: "plan"; assetIds: string[] }
  | { type: "progress"; assetId: string }
  | { type: "done"; slot: EngineSlotRecord }
  | { type: "error"; error: string };

export interface SlotAssignProgress {
  slotId: string;
  assetIds: string[];
  completedIds: string[];
}

export function emptyAssignProgress(slotId: string, assetIds: string[]): SlotAssignProgress {
  return { slotId, assetIds, completedIds: [] };
}

export function currentAssignAssetId(progress: SlotAssignProgress): string | null {
  return progress.assetIds.find((id) => !progress.completedIds.includes(id)) ?? null;
}

export function describeAssignProgress(progress: SlotAssignProgress): string {
  const total = progress.assetIds.length;
  if (total === 0) return "processing";
  const current = Math.min(progress.completedIds.length + 1, total);
  return `processing ${current} of ${total}`;
}

/** Proxies and gzip often hold tiny NDJSON lines until a few KB arrive. */
export const ASSIGN_STREAM_FLUSH_PAD = `${" ".repeat(2048)}\n`;

export function encodeAssignEvent(event: AssignStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseAssignStreamLine(line: string): AssignStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;

  if (parsed.type === "plan" && isStringArray(parsed.assetIds)) {
    return { type: "plan", assetIds: parsed.assetIds };
  }

  if (parsed.type === "progress" && typeof parsed.assetId === "string") {
    return { type: "progress", assetId: parsed.assetId };
  }

  if (parsed.type === "done" && isRecord(parsed.slot)) {
    return { type: "done", slot: parsed.slot as unknown as EngineSlotRecord };
  }

  if (parsed.type === "error" && typeof parsed.error === "string") {
    return { type: "error", error: parsed.error };
  }

  return null;
}

export function splitNdjson(buffer: string): { events: AssignStreamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: AssignStreamEvent[] = [];
  for (const line of lines) {
    const event = parseAssignStreamLine(line);
    if (event) events.push(event);
  }
  return { events, rest };
}

export function applyAssignStreamEvent(
  progress: SlotAssignProgress,
  event: AssignStreamEvent
): SlotAssignProgress {
  if (event.type === "plan") {
    return { ...progress, assetIds: event.assetIds, completedIds: [] };
  }

  if (event.type === "progress" && !progress.completedIds.includes(event.assetId)) {
    return { ...progress, completedIds: [...progress.completedIds, event.assetId] };
  }

  return progress;
}

export async function consumeAssignEvents(
  chunks: AsyncIterable<string | Uint8Array>,
  onEvent: (event: AssignStreamEvent) => void
): Promise<EngineSlotRecord> {
  const decoder = new TextDecoder();
  let buffer = "";
  let slot: EngineSlotRecord | null = null;

  const handle = (event: AssignStreamEvent): void => {
    onEvent(event);
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "done") slot = event.slot;
  };

  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    const split = splitNdjson(buffer);
    buffer = split.rest;
    for (const event of split.events) handle(event);
  }

  buffer += decoder.decode();
  for (const event of splitNdjson(`${buffer}\n`).events) handle(event);

  if (!slot) throw new Error("assign ended without a slot");
  return slot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
