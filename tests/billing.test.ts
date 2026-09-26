import { describe, expect, it } from "vitest";
import { chooseBillingKey } from "@/shared/billing";

const personal = { id: "p", provider: "openai", isDefault: false };
const studio = { id: "s", provider: "openai", isDefault: true };
const gemini = { id: "g", provider: "gemini", isDefault: false };

describe("chooseBillingKey", () => {
  it("prefers the project's pick", () => {
    expect(chooseBillingKey("openai", [personal, studio], { openai: "p" })).toEqual({
      ok: true,
      keyId: "p",
      via: "project"
    });
  });

  it("falls back to the account default, ignoring a project pick that is gone", () => {
    expect(chooseBillingKey("openai", [personal, studio], { openai: "deleted" })).toEqual({
      ok: true,
      keyId: "s",
      via: "account"
    });
  });

  it("uses the only key without a default", () => {
    expect(chooseBillingKey("gemini", [personal, gemini], {})).toEqual({
      ok: true,
      keyId: "g",
      via: "only"
    });
  });

  it("refuses to guess between several keys", () => {
    expect(chooseBillingKey("openai", [personal, { ...studio, isDefault: false }], {})).toEqual({
      ok: false,
      reason: "no-default"
    });
  });

  it("reports a provider with no key", () => {
    expect(chooseBillingKey("gemini", [personal], {})).toEqual({ ok: false, reason: "no-key" });
  });
});
