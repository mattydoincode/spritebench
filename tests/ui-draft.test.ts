import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANIMATION,
  DEFAULT_CHUNK,
  DEFAULT_COLLAPSED_SECTIONS,
  DEFAULT_ITEM_GRID,
  DEFAULT_EACH,
  DEFAULT_LOOP,
  DEFAULT_PROJECT_DRAFT,
  persistProjectDrafts,
  readCollapsedSections,
  readProjectDraft,
  readProjectDrafts,
  sectionCollapsed,
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
        ...draft({
          promptBody: "a rusty chest",
          mask: {
            source: { kind: "template", templateId: "builtin:iso-diamond" },
            maskSource: "keepInsideShape",
            dilatePixels: 0,
            fit: "contain"
          }
        }),
        activeProjectId: "alpha",
        drafts: {}
      },
      "beta"
    );

    expect(afterB.promptBody).toBe("");
    expect(afterB.mask).toBeNull();
    expect(afterB.drafts.alpha?.promptBody).toBe("a rusty chest");
    expect(afterB.drafts.alpha?.mask?.source).toEqual({
      kind: "template",
      templateId: "builtin:iso-diamond"
    });

    const back = switchProjectDraft(
      { ...afterB, promptBody: "a marble fountain" },
      "alpha"
    );

    expect(back.promptBody).toBe("a rusty chest");
    expect(back.mask?.source).toEqual({
      kind: "template",
      templateId: "builtin:iso-diamond"
    });
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
      promptBody: "old global prompt"
    });

    expect(drafts.alpha?.promptBody).toBe("old global prompt");
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
    expect(parsed.animation).toEqual(DEFAULT_ANIMATION);
    expect(parsed.itemGrid).toEqual(DEFAULT_ITEM_GRID);
    expect(parsed.loop).toEqual(DEFAULT_LOOP);
    expect(parsed.chunk).toEqual(DEFAULT_CHUNK);
    expect(parsed.each).toEqual(DEFAULT_EACH);
    expect(parsed.variables).toEqual([]);
    expect(parsed.animateExpansions).toBe(false);
    expect(parsed.bases).toEqual([]);
    expect(parsed.mask).toBeNull();
  });

  it("keeps bases and mask across a project switch", () => {
    const base = {
      source: { kind: "asset" as const, assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
      fit: "contain" as const,
      matchAspect: true
    };

    const afterB = switchProjectDraft(
      {
        ...draft({ promptBody: "first", bases: [base] }),
        activeProjectId: "alpha",
        drafts: {}
      },
      "beta"
    );

    expect(afterB.bases).toEqual([]);

    const back = switchProjectDraft(afterB, "alpha");
    expect(back.bases).toEqual([base]);
  });
});

describe("collapsed panel sections", () => {
  it("keeps model and cleanup closed until they are written", () => {
    expect(sectionCollapsed("generate.model", {})).toBe(true);
    expect(sectionCollapsed("inspector.cleanup", {})).toBe(true);
    expect(sectionCollapsed("inspector.size", {})).toBe(false);
    expect(sectionCollapsed("generate.prompt", {})).toBe(false);
  });

  it("honours an explicit stored choice over the default", () => {
    expect(sectionCollapsed("generate.model", { "generate.model": false })).toBe(false);
    expect(sectionCollapsed("inspector.size", { "inspector.size": true })).toBe(true);
  });

  it("drops junk from localStorage", () => {
    expect(readCollapsedSections({ "inspector.size": true, leftover: "no" })).toEqual({
      "inspector.size": true
    });
    expect(readCollapsedSections(null)).toEqual({});
    expect(DEFAULT_COLLAPSED_SECTIONS["generate.model"]).toBe(true);
  });
});
