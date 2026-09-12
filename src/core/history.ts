/**
 * A linear undo stack for one person's local session.
 *
 * Not Yjs: the slicer's draft is not in the document until Apply, and the
 * scene's undo manager would otherwise rewind a collaborator's camera-less
 * work. One present, a past, a future. `replace` is the live drag;
 * `commit` / `commitFrom` are the gesture landing.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function replace<T>(history: History<T>, present: T): History<T> {
  return { ...history, present };
}

export function commit<T>(
  history: History<T>,
  present: T,
  same: (left: T, right: T) => boolean
): History<T> {
  if (same(history.present, present)) return history;

  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present,
    future: []
  };
}

/**
 * After a drag that already `replace`d `present`, fold the pre-drag value
 * onto the stack as one step.
 */
export function commitFrom<T>(
  history: History<T>,
  previous: T,
  same: (left: T, right: T) => boolean
): History<T> {
  if (same(previous, history.present)) return history;

  return {
    past: [...history.past, previous].slice(-LIMIT),
    present: history.present,
    future: []
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;

  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;

  return {
    past: [...history.past, history.present].slice(-LIMIT),
    present: next,
    future: history.future.slice(1)
  };
}
