import { isIsoDiamondTemplate } from "@/core/isoMask";
import { isLayoutGuideTemplate, isPixelConstraintTemplate } from "@/core/pixelMask";
import { findModel } from "@/providers/models";
import { gridInstructions, itemGridInstructions, planAnimation, planItemGrid } from "./animationPrompt";
import type { BaseSpec, MaskSpec, PromptSpec } from "./model";

/**
 * Extra text a feature prepends or appends. Not the house style — that is
 * prefix/suffix — and not the subject. These are the instructions that used
 * to be hardcoded next to a mask or a sheet and were invisible until send.
 */

export type FeaturePromptId =
  | "guide"
  | "reference"
  | "iso-diamond"
  | "pixel-constraint"
  | "animation"
  | "item-grid";

export type FeaturePromptSlot = "guide" | "extra";

export interface FeaturePrompt {
  id: FeaturePromptId;
  slot: FeaturePromptSlot;
  label: string;
  defaultText: string;
}

export interface FeaturePromptContext {
  model: string;
  mask?: MaskSpec | null;
  base?: BaseSpec | null;
  animation?: { enabled: boolean; actions: { name: string; frames: number }[]; cellSize: number } | null;
  itemGrid?: { enabled: boolean; columns: number; rows: number; cellSize: number } | null;
}

/**
 * Gemini has no mask channel. These go in front of the user prompt on edit
 * calls so the inspector can show the same text the provider sent.
 */
export const GEMINI_GUIDE_INSTRUCTIONS = [
  "The attached image is a layout guide, not the finished artwork.",
  "White pixels mark empty regions you must fill with the subject.",
  "Non-white pixels are already finished. Copy them into the result unchanged — same colour, edges, and position. Do not restyle or redraw them.",
  "Do not render the guide itself: no paper texture, no pencil on the white, no black bars, no mask, no checkerboard, no labels.",
  "Return one finished illustration that matches the guide's layout."
].join(" ");

export const GEMINI_REFERENCE_INSTRUCTIONS =
  "The attached image is a composition reference. Keep its pose, proportions, and layout. Draw a new finished illustration of the subject; do not trace the reference as line art unless the prompt asks for that.";

export const ISO_DIAMOND_INSTRUCTIONS = [
  "The attached image is a layout plate, not the finished artwork.",
  "White pixels mark the isometric diamond — fill them with the subject.",
  "Leave the black pixels unchanged. Do not draw the guide itself."
].join(" ");

export const PIXEL_CONSTRAINT_INSTRUCTIONS = [
  "The attached image is a layout plate, not the finished artwork.",
  "The grey checkerboard is a pixel grid: each square is exactly one sprite pixel.",
  "Fill every square with a single flat colour. Do not blend across squares or leave the guide grey.",
  "Paint the outside white. Do not draw the checkerboard itself in the result."
].join(" ");

function isGemini(model: string): boolean {
  return findModel(model)?.provider === "gemini";
}

function templateId(source: { kind: string; templateId?: string } | null | undefined): string | null {
  if (source?.kind !== "template" || !source.templateId) return null;
  return source.templateId;
}

function layoutGuideId(
  mask: MaskSpec | null | undefined,
  base: BaseSpec | null | undefined
): string | null {
  const fromMask = templateId(mask?.source);
  if (fromMask && isLayoutGuideTemplate(fromMask)) return fromMask;
  const fromBase = templateId(base?.source);
  if (fromBase && isLayoutGuideTemplate(fromBase)) return fromBase;
  return null;
}

/** A builtin plate picked as a reference is a mask, not a composition reference. */
export function normalizeLayoutGuideInputs(inputs: {
  base?: BaseSpec | null;
  mask?: MaskSpec | null;
}): { base: BaseSpec | null; mask: MaskSpec | null } {
  if (inputs.mask) {
    return { base: inputs.base ?? null, mask: inputs.mask };
  }

  const id = templateId(inputs.base?.source);
  if (!id || !isLayoutGuideTemplate(id)) {
    return { base: inputs.base ?? null, mask: inputs.mask ?? null };
  }

  return {
    base: null,
    mask: isPixelConstraintTemplate(id)
      ? {
          source: { kind: "template", templateId: id },
          maskSource: "transparentWhereLight",
          dilatePixels: 0,
          fit: "stretch"
        }
      : {
          source: { kind: "template", templateId: id },
          maskSource: "keepInsideShape",
          dilatePixels: 0,
          fit: "contain"
        }
  };
}

function sheetActive(ctx: FeaturePromptContext): boolean {
  return Boolean(ctx.animation?.enabled || ctx.itemGrid?.enabled);
}

export function activeFeaturePrompts(ctx: FeaturePromptContext): FeaturePrompt[] {
  const extras: FeaturePrompt[] = [];
  const gemini = isGemini(ctx.model);
  const guideId = layoutGuideId(ctx.mask, ctx.base);
  const customMask = Boolean(ctx.mask) && !guideId;
  const realReference =
    Boolean(ctx.base) && !layoutGuideId(null, ctx.base);
  const id = guideId ?? templateId(ctx.mask?.source);

  if (gemini && realReference) {
    extras.push({
      id: "reference",
      slot: "guide",
      label: "Reference guide",
      defaultText: GEMINI_REFERENCE_INSTRUCTIONS
    });
  }

  // Layout plates carry their own read-the-plate text. The generic Gemini
  // mask preamble only applies to a custom stencil or a sheet.
  if (gemini && (customMask || (sheetActive(ctx) && !guideId))) {
    extras.push({
      id: "guide",
      slot: "guide",
      label: "Mask guide",
      defaultText: GEMINI_GUIDE_INSTRUCTIONS
    });
  }

  if (id && isIsoDiamondTemplate(id)) {
    extras.push({
      id: "iso-diamond",
      slot: "extra",
      label: "Iso diamond",
      defaultText: ISO_DIAMOND_INSTRUCTIONS
    });
  }

  if (id && isPixelConstraintTemplate(id)) {
    extras.push({
      id: "pixel-constraint",
      slot: "extra",
      label: "Pixel constraint",
      defaultText: PIXEL_CONSTRAINT_INSTRUCTIONS
    });
  }

  if (ctx.animation?.enabled) {
    const planned = planAnimation({
      subject: "",
      actions: ctx.animation.actions,
      cellSize: ctx.animation.cellSize
    });
    extras.push({
      id: "animation",
      slot: "extra",
      label: "Sheet",
      defaultText: gridInstructions(
        ctx.animation.actions,
        planned.sheet.columns,
        planned.sheet.rows
      )
    });
  } else if (ctx.itemGrid?.enabled) {
    const planned = planItemGrid({
      subject: "",
      columns: ctx.itemGrid.columns,
      rows: ctx.itemGrid.rows,
      cellSize: ctx.itemGrid.cellSize
    });
    extras.push({
      id: "item-grid",
      slot: "extra",
      label: "Sheet",
      defaultText: itemGridInstructions(
        ctx.itemGrid.columns,
        ctx.itemGrid.rows,
        planned.sheet.columns,
        planned.sheet.rows
      )
    });
  }

  return extras;
}

export function resolveFeatureText(
  extra: FeaturePrompt,
  overrides: Record<string, string>
): string {
  const override = overrides[extra.id];
  return typeof override === "string" ? override : extra.defaultText;
}

export function composeFeatureSlots(
  extras: FeaturePrompt[],
  overrides: Record<string, string>
): { guide: string; extra: string } {
  const guide: string[] = [];
  const extra: string[] = [];

  for (const entry of extras) {
    const text = resolveFeatureText(entry, overrides).trim();
    if (!text) continue;
    if (entry.slot === "guide") guide.push(text);
    else extra.push(text);
  }

  return { guide: guide.join("\n\n"), extra: extra.join("\n\n") };
}

export function workingPrompt(
  ctx: FeaturePromptContext & {
    prefix: string;
    body: string;
    suffix: string;
    overrides: Record<string, string>;
  }
): PromptSpec {
  const slots = composeFeatureSlots(activeFeaturePrompts(ctx), ctx.overrides);
  return {
    guide: slots.guide,
    prefix: ctx.prefix,
    body: ctx.body,
    extra: slots.extra,
    suffix: ctx.suffix
  };
}
