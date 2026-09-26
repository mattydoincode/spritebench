import {
  dropSlotAssignment,
  mergeSlotAssignment,
  moveSlotAssignment,
  replaceSlotAssignment,
  type EngineSlotIntent
} from "./engineSlot";

/**
 * One change a user made to a slot's assignment. Edits are queued per slot
 * and applied to whatever the slot holds when they run, so a remove or a move
 * queued behind an add does not undo the add.
 */
export type SlotEdit =
  | { type: "add"; assetIds: string[] }
  | { type: "replace"; assetIds: string[] }
  | { type: "drop"; assetIds: string[] }
  | { type: "move"; assetId: string; delta: number };

export function applySlotEdit(
  intent: EngineSlotIntent,
  current: readonly string[],
  edit: SlotEdit
): string[] {
  switch (edit.type) {
    case "add":
      return mergeSlotAssignment(intent, current, edit.assetIds);
    case "replace":
      return replaceSlotAssignment(intent, edit.assetIds);
    case "drop":
      return dropSlotAssignment(current, edit.assetIds);
    case "move":
      return moveSlotAssignment(current, current.indexOf(edit.assetId), edit.delta);
  }
}

/** Folds a batch of queued edits into the one assignment to send. */
export function applySlotEdits(
  intent: EngineSlotIntent,
  current: readonly string[],
  edits: readonly SlotEdit[]
): string[] {
  return edits.reduce<string[]>((ids, edit) => applySlotEdit(intent, ids, edit), [...current]);
}

export function sameAssignment(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
