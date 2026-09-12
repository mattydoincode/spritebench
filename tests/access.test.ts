import { describe, expect, it } from "vitest";
import { permits, type Capability, type Membership } from "@/server/capabilities";
import type { ProjectRole } from "@/db/schema";

function member(role: ProjectRole, extras: Partial<Membership> = {}): Membership {
  return {
    projectId: "p1",
    userId: "u1",
    role,
    canGenerate: false,
    isOwner: role === "owner",
    ...extras
  };
}

const CAPABILITIES: Capability[] = ["view", "edit", "generate", "own"];

describe("permits", () => {
  it("lets an owner do everything", () => {
    const owner = member("owner");

    for (const capability of CAPABILITIES) {
      expect(permits(owner, capability)).toBe(true);
    }
  });

  /**
   * A viewer is the whole point of the capability split: someone you want to
   * show the work to without letting them rearrange it or spend your money.
   */
  it("lets a viewer look and nothing else", () => {
    const viewer = member("viewer");

    expect(permits(viewer, "view")).toBe(true);
    expect(permits(viewer, "edit")).toBe(false);
    expect(permits(viewer, "generate")).toBe(false);
    expect(permits(viewer, "own")).toBe(false);
  });

  it("refuses a viewer generation even when the flag is set", () => {
    expect(permits(member("viewer", { canGenerate: true }), "generate")).toBe(false);
  });

  /**
   * Generation is separate from editing because it bills the owner. An editor
   * gets it only when the owner has granted it explicitly.
   */
  it("gates an editor's generation on the flag", () => {
    expect(permits(member("editor"), "edit")).toBe(true);
    expect(permits(member("editor"), "generate")).toBe(false);
    expect(permits(member("editor", { canGenerate: true }), "generate")).toBe(true);
  });

  it("never grants ownership to a non-owner, whatever their flags", () => {
    for (const role of ["editor", "viewer"] as const) {
      expect(permits(member(role, { canGenerate: true }), "own")).toBe(false);
    }
  });

  /**
   * `isOwner` comes from the project row, not the membership role, so the two
   * can disagree if a project is transferred. The row wins.
   */
  it("trusts isOwner over the role for owner-only actions", () => {
    expect(permits(member("editor", { isOwner: true }), "own")).toBe(true);
    expect(permits(member("owner", { isOwner: false }), "own")).toBe(false);
  });

  it("grants view to every role", () => {
    for (const role of ["owner", "editor", "viewer"] as const) {
      expect(permits(member(role), "view")).toBe(true);
    }
  });
});
