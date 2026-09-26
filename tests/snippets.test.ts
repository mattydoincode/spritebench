import { describe, expect, it } from "vitest";
import {
  cleanSnippetName,
  completeSnippet,
  expandSnippets,
  insertAt,
  matchSnippetNames,
  snippetQueryAt,
  snippetRefs,
  snippetSegments
} from "@/shared/snippets";
import { carryVariables } from "@/shared/promptVars";

const style = { name: "style", text: "pixel art, {palette} palette" };

describe("snippet references", () => {
  it("finds @names once each, in order, and skips email addresses", () => {
    expect(snippetRefs("@style knight @hero, @style again, me@example.com")).toEqual([
      "style",
      "hero"
    ]);
  });

  it("fills known names and leaves unknown ones as written", () => {
    expect(expandSnippets("a knight, @style, @missing", [style])).toBe(
      "a knight, pixel art, {palette} palette, @missing"
    );
  });

  it("does not expand a snippet inside a snippet", () => {
    expect(expandSnippets("@outer", [{ name: "outer", text: "see @inner" }, { name: "inner", text: "x" }])).toBe(
      "see @inner"
    );
  });

  it("splits into plain and snippet segments", () => {
    expect(snippetSegments("a @style b", [style])).toEqual([
      { text: "a " },
      { text: style.text, snippet: "style" },
      { text: " b" }
    ]);
  });

  it("cleans a typed name into something @ can reference", () => {
    expect(cleanSnippetName("  16-bit house ")).toBe("_16_bit_house");
    expect(cleanSnippetName("top down")).toBe("top_down");
  });

  it("inserts a token with spaces only where it would touch a word", () => {
    expect(insertAt("a knight", 8, "@style")).toEqual({ text: "a knight @style", caret: 15 });
    expect(insertAt("a knight", 2, "@style")).toEqual({ text: "a @style knight", caret: 8 });
    expect(insertAt("", 0, "{var}")).toEqual({ text: "{var}", caret: 5 });
  });
});

describe("carrying variables through prompt edits", () => {
  const colors = [{ name: "color", values: "red, blue" }];

  it("renames when one slot is respelled", () => {
    const result = carryVariables("a {color} cat", "a {colour} cat", colors, null);
    expect(result.variables).toEqual([{ name: "colour", values: "red, blue" }]);
  });

  it("carries values through deleting a name and typing a new one", () => {
    const gone = carryVariables("a {c} cat", "a {} cat", [{ name: "c", values: "red" }], null);
    expect(gone.orphan).toBe("c");

    const back = carryVariables("a {} cat", "a {h} cat", gone.variables, gone.orphan);
    expect(back.variables).toEqual([{ name: "h", values: "red" }]);
    expect(back.orphan).toBeNull();
  });

  it("does not take over a name that already has values", () => {
    const both = [...colors, { name: "size", values: "small" }];
    const result = carryVariables("{color} {x}", "{size} {x}", both, null);
    expect(result.variables).toEqual(both);
  });

  it("leaves values alone when an edit does not touch slots", () => {
    const result = carryVariables("a {color} cat", "a {color} dog", colors, "old");
    expect(result).toEqual({ variables: colors, orphan: "old" });
  });
});

describe("snippet autocomplete", () => {
  it("finds the @partial the caret ends", () => {
    expect(snippetQueryAt("a knight @sty", 13)).toEqual({ start: 9, query: "sty" });
    expect(snippetQueryAt("a knight @", 10)).toEqual({ start: 9, query: "" });
    expect(snippetQueryAt("me@exa", 6)).toBeNull();
    expect(snippetQueryAt("@style done", 11)).toBeNull();
  });

  it("ranks prefix matches before contained ones", () => {
    expect(matchSnippetNames(["hero_style", "style", "stone"], "st")).toEqual([
      "style",
      "stone",
      "hero_style"
    ]);
  });

  it("completes with a trailing space unless one follows", () => {
    expect(completeSnippet("a @sty", 2, 6, "style")).toEqual({ text: "a @style ", caret: 9 });
    expect(completeSnippet("a @sty knight", 2, 6, "style")).toEqual({
      text: "a @style knight",
      caret: 8
    });
  });
});
