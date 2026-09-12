"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  canRedo,
  canUndo,
  commit,
  commitFrom,
  createHistory,
  redo,
  replace,
  undo,
  type History
} from "@/core/history";

/**
 * Local undo for a modal that is not writing to the document yet.
 *
 * `replace` is the pointer-move path. `begin` / `end` turn that live trail
 * into one stack entry. `commit` is a finished click: tighten, fit to grid.
 */
export function useHistory<T>(initial: T, same: (left: T, right: T) => boolean) {
  const [history, setHistory] = useState<History<T>>(() => createHistory(initial));
  const presentRef = useRef(history.present);
  presentRef.current = history.present;
  const checkpoint = useRef<T | null>(null);
  const sameRef = useRef(same);
  sameRef.current = same;

  const reset = useCallback((present: T) => {
    checkpoint.current = null;
    setHistory(createHistory(present));
  }, []);

  const replacePresent = useCallback((next: T | ((was: T) => T)) => {
    setHistory((was) =>
      replace(was, typeof next === "function" ? (next as (value: T) => T)(was.present) : next)
    );
  }, []);

  const commitPresent = useCallback((next: T | ((was: T) => T)) => {
    setHistory((was) => {
      const present = typeof next === "function" ? (next as (value: T) => T)(was.present) : next;
      return commit(was, present, sameRef.current);
    });
  }, []);

  const begin = useCallback(() => {
    checkpoint.current = presentRef.current;
  }, []);

  const end = useCallback(() => {
    const previous = checkpoint.current;
    checkpoint.current = null;
    if (previous === null) return;
    setHistory((was) => commitFrom(was, previous, sameRef.current));
  }, []);

  const undoPresent = useCallback(() => {
    setHistory((was) => undo(was));
  }, []);

  const redoPresent = useCallback(() => {
    setHistory((was) => redo(was));
  }, []);

  return useMemo(
    () => ({
      present: history.present,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      reset,
      replace: replacePresent,
      commit: commitPresent,
      begin,
      end,
      undo: undoPresent,
      redo: redoPresent
    }),
    [history, reset, replacePresent, commitPresent, begin, end, undoPresent, redoPresent]
  );
}

export function sameJson<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
