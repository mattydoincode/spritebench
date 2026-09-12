import { isPixelConstraintTemplate } from "@/core/pixelMask";
import type { Size } from "@/core/types";
import { findModel, modelOrDefault, providerLabel, snapRequestSize } from "@/providers/models";
import { snapRatioRequest } from "@/providers/ratio";
import { GEMINI_GUIDE_INSTRUCTIONS, GEMINI_REFERENCE_INSTRUCTIONS } from "./featurePrompt";
import {
  composePrompt,
  isChunkSpec,
  isLoopSpec,
  jobUsesEdit,
  jobUsesMask,
  type GenerationParams,
  type ImageSource,
  type JobInputs,
  type PromptSpec,
  type SequencePlan,
  type TokenUsage
} from "./model";

export { GEMINI_GUIDE_INSTRUCTIONS, GEMINI_REFERENCE_INSTRUCTIONS };

export type PromptSectionId = "system" | "guide" | "prefix" | "body" | "extra" | "suffix";

export interface PromptSection {
  id: PromptSectionId;
  label: string;
  text: string;
}

export type AttachmentRole = "guide" | "reference" | "base" | "mask";

export interface AttachmentPlan {
  id: AttachmentRole;
  label: string;
}

export interface ProviderPromptInput {
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
}

function isGemini(model: string): boolean {
  return findModel(model)?.provider === "gemini";
}

function usesMask(input: ProviderPromptInput): boolean {
  return jobUsesMask(input);
}

function sourceLabel(source: ImageSource): string {
  return source.kind === "template" ? source.templateId : `asset ${source.assetId.slice(0, 8)}`;
}

export function providerSystemText(input: ProviderPromptInput): string {
  const stored = input.prompt.guide?.trim() ?? "";
  if (stored) return stored;
  if (!isGemini(input.generation.model) || !jobUsesEdit(input)) return "";
  return usesMask(input) ? GEMINI_GUIDE_INSTRUCTIONS : GEMINI_REFERENCE_INSTRUCTIONS;
}

/** The exact user+system string the provider call received. */
export function composeProviderPrompt(input: ProviderPromptInput): string {
  const composed = input.composedPrompt.trim();
  if (composed) return composed;

  const prompt = input.prompt.guide?.trim()
    ? input.prompt
    : { ...input.prompt, guide: providerSystemText(input) };
  return composePrompt(prompt);
}

export function providerPromptSections(input: ProviderPromptInput): PromptSection[] {
  const sections: PromptSection[] = [];
  const system = providerSystemText(input);
  if (system) sections.push({ id: "system", label: "guide", text: system });

  const parts: Array<[PromptSectionId, string, string]> = [
    ["prefix", "prefix", input.prompt.prefix],
    ["body", "prompt", input.prompt.body],
    ["extra", "extra", input.prompt.extra ?? ""],
    ["suffix", "suffix", input.prompt.suffix]
  ];

  for (const [id, label, text] of parts) {
    if (text.trim().length > 0) sections.push({ id, label, text });
  }

  return sections;
}

export function providerAttachmentPlan(input: ProviderPromptInput): AttachmentPlan[] {
  if (!jobUsesEdit(input)) return [];

  if (isGemini(input.generation.model)) {
    const pixel =
      input.inputs?.mask?.source.kind === "template" &&
      isPixelConstraintTemplate(input.inputs.mask.source.templateId);
    if (input.inputs?.base && pixel) {
      return [
        { id: "reference", label: "starting image" },
        { id: "guide", label: "pixel grid" }
      ];
    }
    return usesMask(input)
      ? [{ id: "guide", label: "layout guide · white = draw" }]
      : [{ id: "reference", label: "composition reference" }];
  }

  const attachments: AttachmentPlan[] = [{ id: "base", label: "base image" }];
  const pixel =
    input.inputs?.mask?.source.kind === "template" &&
    isPixelConstraintTemplate(input.inputs.mask.source.templateId);
  if (input.inputs?.base && pixel) attachments.push({ id: "guide", label: "pixel grid" });
  if (usesMask(input)) attachments.push({ id: "mask", label: "mask · transparent = draw" });
  return attachments;
}

export interface AuditKey {
  provider: string;
  label: string;
  keySuffix: string;
}

export interface ProviderAuditInput extends ProviderPromptInput {
  sourceSize?: Size | null;
  /** Pixel size the provider call actually used, after template/sheet snap. */
  resolvedSize?: Size | null;
  usage?: TokenUsage | null;
  elapsedSeconds?: number | null;
  createdAt?: string | null;
  key?: AuditKey | null;
  /** Set when the job is still listed. Null means the environment-key path. */
  billedKeyId?: string | null;
}

export interface AuditLine {
  label: string;
  value: string;
}

function px(size: Size): string {
  return `${size.width}×${size.height}`;
}

function sentSize(generation: GenerationParams, resolved?: Size | null): string {
  const model = modelOrDefault(generation.model);
  const pixels = resolved ?? (generation.useAutoSize ? null : generation.size);
  if (!pixels) return "auto";

  if (model.sizing === "ratio") {
    const snapped = snapRatioRequest(pixels);
    return `${px(snapped.size)} (${snapped.aspectRatio} · ${snapped.imageSize})`;
  }

  return px(snapRequestSize(pixels, generation.model));
}

function keyLine(key: AuditKey): string {
  const suffix = key.keySuffix.replace(/^\.\.\./, "");
  const name = key.label.trim() || "key";
  return `${providerLabel(key.provider)} · ${name}${suffix ? ` · …${suffix}` : ""}`;
}

/** Small-print log of what the provider call billed and asked for. */
export function providerAuditLines(input: ProviderAuditInput): AuditLine[] {
  const model = modelOrDefault(input.generation.model);
  const generation = input.generation;
  const lines: AuditLine[] = [
    { label: "model", value: `${model.label} · ${providerLabel(model.provider)}` },
    {
      label: "call",
      value: jobUsesEdit(input) ? (usesMask(input) ? "edit · masked" : "edit · reference") : "generate"
    }
  ];

  if (input.key) lines.push({ label: "key", value: keyLine(input.key) });
  else if (input.billedKeyId) lines.push({ label: "key", value: "removed from account" });
  else if (input.billedKeyId === null) lines.push({ label: "key", value: "environment fallback" });

  const asked = generation.useAutoSize ? "auto" : px(generation.size);
  const sent = sentSize(generation, input.resolvedSize);
  const got = input.sourceSize ? px(input.sourceSize) : null;
  lines.push({
    label: "size",
    value: got ? `asked ${asked} · sent ${sent} · got ${got}` : `asked ${asked} · sent ${sent}`
  });

  if (model.supportsQuality) {
    lines.push({
      label: "quality",
      value: generation.quality === "auto" ? "auto · omitted" : generation.quality
    });
  }
  if (model.supportsBackground) {
    lines.push({
      label: "background",
      value: generation.background === "auto" ? "auto · omitted" : generation.background
    });
  }
  if (model.supportsModeration) {
    lines.push({
      label: "moderation",
      value: generation.moderation === "auto" ? "auto" : generation.moderation
    });
  }

  lines.push({ label: "images", value: String(generation.imageCount) });

  const inputs = input.inputs;
  if (inputs?.base) {
    lines.push({
      label: "base",
      value: [
        sourceLabel(inputs.base.source),
        inputs.base.fit,
        inputs.base.matchAspect ? "match aspect" : null
      ]
        .filter((part) => part)
        .join(" · ")
    });
  }

  if (inputs?.mask) {
    lines.push({
      label: "mask",
      value: [sourceLabel(inputs.mask.source), inputs.mask.maskSource, inputs.mask.fit]
        .filter((part) => part)
        .join(" · ")
    });
  }

  if (inputs && isLoopSpec(inputs.loop)) {
    lines.push({ label: "loop", value: `step ${inputs.loop.index} of ${inputs.loop.steps}` });
  }

  if (inputs && isChunkSpec(inputs.chunk)) {
    const chunk = inputs.chunk;
    lines.push({
      label: "chunk",
      value: `${chunk.columns}×${chunk.rows} · cell ${chunk.index + 1}`
    });
  }

  if (input.sequencePlan?.actions?.length) {
    const plan = input.sequencePlan;
    lines.push({
      label: "sheet",
      value: `${plan.columns}×${plan.rows} · ${plan.actions.map((action) => `${action.name} ${action.frames}`).join(", ")}`
    });
  }

  if (input.usage && input.usage.totalTokens > 0) {
    lines.push({
      label: "tokens",
      value: `${input.usage.totalTokens} · ${input.usage.inputTokens} in / ${input.usage.outputTokens} out`
    });
  }

  if (input.elapsedSeconds != null && input.elapsedSeconds > 0) {
    lines.push({ label: "time", value: `${input.elapsedSeconds.toFixed(1)}s` });
  }

  if (input.createdAt) {
    const stamp = Date.parse(input.createdAt);
    if (Number.isFinite(stamp)) {
      lines.push({ label: "at", value: new Date(stamp).toLocaleString() });
    }
  }

  return lines;
}
