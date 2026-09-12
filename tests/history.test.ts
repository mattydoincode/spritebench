import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, commitFrom, createHistory, redo, replace, undo } from "@/core/history";

const same = (left: number, right: number) => left === right;

describe("history", () => {
  it("commits a new present and can walk back and forward", () => {
    let history = createHistory(1);
    history = commit(history, 2, same);
    history = commit(history, 3, same);

    expect(history.present).toBe(3);
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.present).toBe(2);

    history = undo(history);
    expect(history.present).toBe(1);
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(history.present).toBe(2);
    expect(canRedo(history)).toBe(true);
  });

  it("does not record a no-op commit", () => {
    const history = commit(createHistory(1), 1, same);

    expect(canUndo(history)).toBe(false);
  });

  it("replace updates the present without a stack entry", () => {
    const history = replace(createHistory(1), 9);

    expect(history.present).toBe(9);
    expect(canUndo(history)).toBe(false);
  });

  it("commitFrom folds a drag that already replaced present", () => {
    let history = replace(createHistory(1), 5);
    history = commitFrom(history, 1, same);

    expect(history.present).toBe(5);
    expect(undo(history).present).toBe(1);
  });

  it("drops the future on a new commit", () => {
    let history = commit(createHistory(1), 2, same);
    history = undo(history);
    history = commit(history, 9, same);

    expect(canRedo(history)).toBe(false);
    expect(history.present).toBe(9);
  });
});
