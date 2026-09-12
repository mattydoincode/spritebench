import { describe, expect, it } from "vitest";
import type { PromptSpec } from "@/shared/model";
import {
  bindPrompt,
  collectSlots,
  expandPrompt,
  insertSlot,
  LOOP_SLOT_NAMES,
  loopBindings,
  loopReservedSlots,
  nextVariableName,
  offeredVariables,
  parseValues,
  planCreate,
  promptForJob
} from "@/shared/promptVars";

function prompt(body: string, prefix = "", suffix = ""): PromptSpec {
  return { prefix, body, suffix };
}

describe("parseValues", () => {
  it("splits a comma list and drops empties", () => {
    expect(parseValues("green, red, blue")).toEqual(["green", "red", "blue"]);
    expect(parseValues(" green, , red,")).toEqual(["green", "red"]);
    expect(parseValues("")).toEqual([]);
  });
});

describe("collectSlots", () => {
  it("returns unique names in first-seen order", () => {
    expect(collectSlots("a {color} {size} and {color} again", "{mood}")).toEqual([
      "color",
      "size",
      "mood"
    ]);
  });

  it("ignores braces that are not identifiers", () => {
    expect(collectSlots("use {1} or {not-valid} or {ok_2}")).toEqual(["ok_2"]);
  });
});

describe("expandPrompt", () => {
  it("returns the original prompt when nothing is slotted", () => {
    const expansions = expandPrompt(prompt("a rusty bin"), [{ name: "color", values: "green" }]);

    expect(expansions).toHaveLength(1);
    expect(expansions[0].prompt.body).toBe("a rusty bin");
    expect(expansions[0].bindings).toEqual({});
  });

  it("leaves an unknown slot literal", () => {
    const expansions = expandPrompt(prompt("a {color} bin"), []);

    expect(expansions).toHaveLength(1);
    expect(expansions[0].prompt.body).toBe("a {color} bin");
  });

  it("returns nothing when a used slot has no values", () => {
    expect(expandPrompt(prompt("a {color} bin"), [{ name: "color", values: "  ,  " }])).toEqual([]);
  });

  it("multiplies in definition order, first listed slowest", () => {
    const expansions = expandPrompt(prompt("a {color} {size} crate"), [
      { name: "color", values: "green, red" },
      { name: "size", values: "small, large" }
    ]);

    expect(expansions.map((entry) => entry.prompt.body)).toEqual([
      "a green small crate",
      "a green large crate",
      "a red small crate",
      "a red large crate"
    ]);
  });

  it("substitutes prefix and suffix too", () => {
    const expansions = expandPrompt(prompt("a {item}", "paint it {color}", "on {ground}"), [
      { name: "color", values: "green" },
      { name: "item", values: "bin" },
      { name: "ground", values: "asphalt" }
    ]);

    expect(expansions).toHaveLength(1);
    expect(expansions[0].prompt).toEqual({
      prefix: "paint it green",
      body: "a bin",
      suffix: "on asphalt"
    });
  });

  it("labels with the binding then the body", () => {
    const [first] = expandPrompt(prompt("rusty bin"), [{ name: "color", values: "green" }]);
    expect(first.label).toBe("rusty bin");

    const [green] = expandPrompt(prompt("a {color} bin"), [{ name: "color", values: "green" }]);
    expect(green.label).toBe("green · a green bin");
  });
});

describe("planCreate", () => {
  it("is one image when nothing multiplies", () => {
    const plan = planCreate({
      prompt: prompt("a bin"),
      variables: [],
      batches: 1,
      imageCount: 1,
      sheet: false
    });

    expect(plan).toMatchObject({ expansions: 1, jobs: 1, images: 1, breakdown: "", blocked: null });
  });

  it("multiplies variables, batches, and images", () => {
    const plan = planCreate({
      prompt: prompt("a {color} {size} bin"),
      variables: [
        { name: "color", values: "green, red, blue" },
        { name: "size", values: "small, large" }
      ],
      batches: 2,
      imageCount: 1,
      sheet: false
    });

    expect(plan.expansions).toBe(6);
    expect(plan.jobs).toBe(12);
    expect(plan.images).toBe(12);
    expect(plan.breakdown).toBe("3 colors × 2 sizes × 2 batches");
    expect(plan.blocked).toBeNull();
  });

  it("pins a sheet job to one image", () => {
    const plan = planCreate({
      prompt: prompt("street things"),
      variables: [],
      batches: 2,
      imageCount: 4,
      sheet: true
    });

    expect(plan.images).toBe(2);
    expect(plan.breakdown).toBe("2 batches");
  });

  it("blocks an empty used slot", () => {
    const plan = planCreate({
      prompt: prompt("a {color} bin"),
      variables: [{ name: "color", values: "" }],
      batches: 1,
      imageCount: 1,
      sheet: false
    });

    expect(plan.images).toBe(0);
    expect(plan.blocked).toMatch(/at least one value/);
  });

  it("multiplies loop steps and requires a starting image", () => {
    const missing = planCreate({
      prompt: prompt("refine this"),
      variables: [],
      batches: 1,
      imageCount: 2,
      sheet: false,
      loopSteps: 4,
      requiresStart: true,
      hasStart: false
    });

    expect(missing.jobs).toBe(4);
    expect(missing.images).toBe(4);
    expect(missing.breakdown).toBe("4 steps");
    expect(missing.blocked).toMatch(/starting image/);

    const ready = planCreate({
      prompt: prompt("refine this"),
      variables: [],
      batches: 1,
      imageCount: 2,
      sheet: false,
      loopSteps: 4,
      requiresStart: true,
      hasStart: true
    });

    expect(ready.blocked).toBeNull();
  });

  it("multiplies chunk cells", () => {
    const plan = planCreate({
      prompt: prompt("detail this tile"),
      variables: [],
      batches: 2,
      imageCount: 3,
      sheet: false,
      chunkCells: 4,
      requiresStart: true,
      hasStart: true
    });

    expect(plan.jobs).toBe(8);
    expect(plan.images).toBe(8);
    expect(plan.breakdown).toBe("2 batches × 4 chunks");
  });

  it("blocks a fan-out past the limit", () => {
    const plan = planCreate({
      prompt: prompt("a {n} bin"),
      variables: [{ name: "n", values: "1, 2, 3, 4, 5" }],
      batches: 10,
      imageCount: 1,
      sheet: false,
      limit: 40
    });

    expect(plan.images).toBe(50);
    expect(plan.blocked).toMatch(/50 images/);
  });
});

describe("offeredVariables", () => {
  it("appends a blank row for a new slot", () => {
    expect(offeredVariables(prompt("a {color} bin"), [])).toEqual([{ name: "color", values: "" }]);
  });

  it("keeps typed values and does not duplicate", () => {
    const have = [{ name: "color", values: "green" }];
    expect(offeredVariables(prompt("a {color} {size} bin"), have)).toEqual([
      { name: "color", values: "green" },
      { name: "size", values: "" }
    ]);
  });
});

describe("insertSlot", () => {
  it("appends a new token and leaves an existing one alone", () => {
    expect(insertSlot("a crate", "color")).toBe("a crate {color}");
    expect(insertSlot("a {color} crate", "color")).toBe("a {color} crate");
    expect(insertSlot("", "color")).toBe("{color}");
  });

  it("picks an unused name", () => {
    expect(nextVariableName([])).toBe("var");
    expect(nextVariableName([{ name: "var", values: "" }])).toBe("var2");
  });
});

describe("loop slots", () => {
  const reserved = loopReservedSlots(true);

  it("offers step and total_steps only while looping", () => {
    expect(loopReservedSlots(false)).toEqual([]);
    expect(reserved).toEqual([...LOOP_SLOT_NAMES]);
  });

  it("leaves loop slots literal during fan-out", () => {
    const expansions = expandPrompt(
      prompt("step {step} of {total_steps}, a {color} bin"),
      [{ name: "color", values: "green, red" }],
      reserved
    );

    expect(expansions.map((entry) => entry.prompt.body)).toEqual([
      "step {step} of {total_steps}, a green bin",
      "step {step} of {total_steps}, a red bin"
    ]);
  });

  it("does not demand values for reserved slots", () => {
    const plan = planCreate({
      prompt: prompt("step {step} of {total_steps}"),
      variables: [],
      batches: 1,
      imageCount: 1,
      sheet: false,
      loopSteps: 4,
      requiresStart: true,
      hasStart: true,
      reserved
    });

    expect(plan.blocked).toBeNull();
    expect(plan.jobs).toBe(4);
    expect(offeredVariables(prompt("step {step} of {total_steps}"), [], reserved)).toEqual([]);
  });

  it("fills step and total_steps from the concrete loop row", () => {
    const source = prompt("step {step} of {total_steps}");

    expect(promptForJob(source, { loop: { steps: 4, index: 2 } })).toEqual({
      prefix: "",
      body: "step 2 of 4",
      suffix: ""
    });
    expect(promptForJob(source, { loop: { steps: 4 } })).toEqual(source);
    expect(bindPrompt(source, loopBindings({ steps: 4, index: 1 })).body).toBe("step 1 of 4");
  });
});
