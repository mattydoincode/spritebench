import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANIMATION,
  DEFAULT_CHUNK,
  DEFAULT_ITEM_GRID,
  DEFAULT_LOOP,
  DEFAULT_PROJECT_DRAFT,
  persistProjectDrafts,
  readProjectDraft,
  readProjectDrafts,
  switchProjectDraft,
  type ProjectDraft
} from "@/client/stores/ui";

function draft(patch: Partial<ProjectDraft>): ProjectDraft {
  return { ...DEFAULT_PROJECT_DRAFT, ...patch };
}

describe("project prompt drafts", () => {
  it("keeps each project's prompt when switching", () => {
    const afterB = switchProjectDraft(
      {
        ...draft({ promptBody: "a rusty chest", scratch: "chest notes" }),
        activeProjectId: "alpha",
        drafts: {}
      },
      "beta"
    );

    expect(afterB.promptBody).toBe("");
    expect(afterB.scratch).toBe("");
    expect(afterB.drafts.alpha?.promptBody).toBe("a rusty chest");

    const back = switchProjectDraft(
      { ...afterB, promptBody: "a marble fountain" },
      "alpha"
    );

    expect(back.promptBody).toBe("a rusty chest");
    expect(back.scratch).toBe("chest notes");
    expect(back.drafts.beta?.promptBody).toBe("a marble fountain");
  });

  it("does not reset the working prompt when the same project is selected again", () => {
    const next = switchProjectDraft(
      {
        ...draft({ promptBody: "still typing" }),
        activeProjectId: "alpha",
        drafts: { alpha: draft({ promptBody: "stale" }) }
      },
      "alpha"
    );

    expect(next.promptBody).toBe("still typing");
    expect(next.drafts.alpha?.promptBody).toBe("stale");
  });

  it("keeps an in-progress prompt when first landing on a project", () => {
    const next = switchProjectDraft(
      {
        ...draft({ promptBody: "typed on the dashboard" }),
        activeProjectId: null,
        drafts: {}
      },
      "alpha"
    );

    expect(next.promptBody).toBe("typed on the dashboard");
    expect(next.activeProjectId).toBe("alpha");
  });

  it("prefers a saved draft over leftover text when opening a known project from nowhere", () => {
    const next = switchProjectDraft(
      {
        ...draft({ promptBody: "leftover" }),
        activeProjectId: null,
        drafts: { alpha: draft({ promptBody: "saved for alpha" }) }
      },
      "alpha"
    );

    expect(next.promptBody).toBe("saved for alpha");
  });

  it("attributes a legacy single prompt to the last open project", () => {
    const drafts = readProjectDrafts({
      activeProjectId: "alpha",
      promptBody: "old global prompt",
      scratch: "old scratch"
    });

    expect(drafts.alpha?.promptBody).toBe("old global prompt");
    expect(drafts.alpha?.scratch).toBe("old scratch");
  });

  it("reads a already-split drafts map without using leftover top-level fields", () => {
    const drafts = readProjectDrafts({
      activeProjectId: "alpha",
      promptBody: "should be ignored",
      drafts: {
        alpha: { promptBody: "alpha prompt" },
        beta: { promptBody: "beta prompt" }
      }
    });

    expect(drafts.alpha?.promptBody).toBe("alpha prompt");
    expect(drafts.beta?.promptBody).toBe("beta prompt");
  });

  it("writes the working prompt into the active project's draft", () => {
    const drafts = persistProjectDrafts({
      ...draft({ promptBody: "current", folder: "props" }),
      activeProjectId: "alpha",
      drafts: { beta: draft({ promptBody: "other" }) }
    });

    expect(drafts.alpha?.promptBody).toBe("current");
    expect(drafts.alpha?.folder).toBe("props");
    expect(drafts.beta?.promptBody).toBe("other");
  });

  it("fills missing draft fields with defaults", () => {
    const parsed = readProjectDraft({ promptBody: "only a prompt" });

    expect(parsed.promptBody).toBe("only a prompt");
    expect(parsed.scratch).toBe("");
    expect(parsed.animation).toEqual(DEFAULT_ANIMATION);
    expect(parsed.itemGrid).toEqual(DEFAULT_ITEM_GRID);
    expect(parsed.loop).toEqual(DEFAULT_LOOP);
    expect(parsed.chunk).toEqual(DEFAULT_CHUNK);
    expect(parsed.variables).toEqual([]);
  });
});
