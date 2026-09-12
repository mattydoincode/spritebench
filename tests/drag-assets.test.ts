import { describe, expect, it } from "vitest";
import { canAcceptTemplateDrop } from "@/client/dragAssets";

const ASSET = "application/x-art-studio-assets";

describe("canAcceptTemplateDrop", () => {
  it("accepts a library drag on the starting-image slot", () => {
    expect(canAcceptTemplateDrop([ASSET, "text/plain"], true)).toBe(true);
  });

  it("refuses a file drop on the starting-image slot", () => {
    expect(canAcceptTemplateDrop(["Files"], true)).toBe(false);
  });

  it("accepts either on the reference slot", () => {
    expect(canAcceptTemplateDrop([ASSET], false)).toBe(true);
    expect(canAcceptTemplateDrop(["Files"], false)).toBe(true);
  });

  it("does not need the payload, which browsers hide until drop", () => {
    expect(canAcceptTemplateDrop([ASSET], true)).toBe(true);
  });
});
