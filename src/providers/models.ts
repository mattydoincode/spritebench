import { snapFlexibleSize, snapLegacySize } from "@/core/size";
import type { Size } from "@/core/types";
import type { GenerationParams, ImageQuality } from "@/shared/model";
import { snapRatioRequest, snapRatioSize } from "./ratio";
import type { ModelInfo, SizeOption, SizingMode } from "./types";

const STANDARD_QUALITIES: readonly ImageQuality[] = ["auto", "low", "medium", "high"];
const EXTENDED_QUALITIES: readonly ImageQuality[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
];

function size(width: number, height: number, label: string, extra: Partial<SizeOption> = {}): SizeOption {
  return { width, height, label, ...extra };
}

/** GPT Image 2.5 prompting guide common sizes. */
const GPT_IMAGE_25_SIZES: readonly SizeOption[] = [
  size(1024, 1024, "1024x1024 (square)"),
  size(1536, 1024, "1536x1024 (landscape)"),
  size(1024, 1536, "1024x1536 (portrait)"),
  size(2048, 2048, "2048x2048 (2K square)"),
  size(2048, 1152, "2048x1152 (2K landscape)"),
  size(3840, 2160, "3840x2160 (4K landscape)"),
  size(2160, 3840, "2160x3840 (4K portrait)")
];

/** Image 2 cookbook popular sizes, plus the 2K square and 4K portrait that 2.5 lists. */
const GPT_IMAGE_2_SIZES: readonly SizeOption[] = [
  size(1024, 1024, "1024x1024 (square)"),
  size(1536, 1024, "1536x1024 (landscape)"),
  size(1024, 1536, "1024x1536 (portrait)"),
  size(2048, 2048, "2048x2048 (2K square)"),
  size(2560, 1440, "2560x1440 (2K)"),
  size(3840, 2160, "3840x2160 (4K landscape)"),
  size(2160, 3840, "2160x3840 (4K portrait)")
];

/** Image 1 / 1.5 / 1-mini only accept these three. */
const GPT_IMAGE_1_SIZES: readonly SizeOption[] = [
  size(1024, 1024, "1024x1024 (square)"),
  size(1536, 1024, "1536x1024 (landscape)"),
  size(1024, 1536, "1024x1536 (portrait)")
];

/**
 * Gemini official output pixels for the shapes that parallel OpenAI's list.
 * Flash also has a 512 square; Pro starts at 1K.
 */
const GEMINI_COMMON_SIZES: readonly SizeOption[] = [
  size(1024, 1024, "1024x1024 (1K square)", { aspectRatio: "1:1", imageSize: "1K" }),
  size(1376, 768, "1376x768 (1K 16:9)", { aspectRatio: "16:9", imageSize: "1K" }),
  size(768, 1376, "768x1376 (1K 9:16)", { aspectRatio: "9:16", imageSize: "1K" }),
  size(2048, 2048, "2048x2048 (2K square)", { aspectRatio: "1:1", imageSize: "2K" }),
  size(2752, 1536, "2752x1536 (2K 16:9)", { aspectRatio: "16:9", imageSize: "2K" }),
  size(1536, 2752, "1536x2752 (2K 9:16)", { aspectRatio: "9:16", imageSize: "2K" }),
  size(4096, 4096, "4096x4096 (4K square)", { aspectRatio: "1:1", imageSize: "4K" }),
  size(5504, 3072, "5504x3072 (4K 16:9)", { aspectRatio: "16:9", imageSize: "4K" }),
  size(3072, 5504, "3072x5504 (4K 9:16)", { aspectRatio: "9:16", imageSize: "4K" })
];

const GEMINI_FLASH_SIZES: readonly SizeOption[] = [
  size(512, 512, "512x512 (0.5K square)", { aspectRatio: "1:1", imageSize: "512" }),
  ...GEMINI_COMMON_SIZES
];

/**
 * The single source of truth for model capabilities.
 *
 * These used to be spread across three places that had to be kept in sync by
 * hand: the `MODELS` name list in `shared/model.ts`, `BACKGROUND_CAPABLE_MODELS`
 * in the OpenAI client, and `FLEXIBLE_SIZE_MODELS` in `core/size.ts`. Adding a
 * model meant remembering all three.
 *
 * This module is client-safe: no Node built-ins, no secrets.
 */
export const MODEL_REGISTRY: readonly ModelInfo[] = [
  {
    id: "gpt-image-2.5-sunburst",
    provider: "openai",
    label: "gpt-image-2.5 sunburst",
    sizing: "flexible",
    sizes: GPT_IMAGE_25_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: EXTENDED_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2.5-flare",
    provider: "openai",
    label: "gpt-image-2.5 flare",
    sizing: "flexible",
    sizes: GPT_IMAGE_25_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: EXTENDED_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2.5-sunburst-2026-09-08",
    provider: "openai",
    label: "gpt-image-2.5 sunburst (pinned 2026-09-08)",
    sizing: "flexible",
    sizes: GPT_IMAGE_25_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: EXTENDED_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2.5-flare-2026-09-08",
    provider: "openai",
    label: "gpt-image-2.5 flare (pinned 2026-09-08)",
    sizing: "flexible",
    sizes: GPT_IMAGE_25_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: EXTENDED_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2",
    provider: "openai",
    label: "gpt-image-2",
    sizing: "flexible",
    sizes: GPT_IMAGE_2_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: STANDARD_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2-2026-04-21",
    provider: "openai",
    label: "gpt-image-2 (pinned 2026-04-21)",
    sizing: "flexible",
    sizes: GPT_IMAGE_2_SIZES,
    supportsBackground: true,
    supportsQuality: true,
    qualities: STANDARD_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1.5",
    provider: "openai",
    label: "gpt-image-1.5",
    sizing: "legacy",
    sizes: GPT_IMAGE_1_SIZES,
    supportsBackground: false,
    supportsQuality: true,
    qualities: STANDARD_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1",
    provider: "openai",
    label: "gpt-image-1",
    sizing: "legacy",
    sizes: GPT_IMAGE_1_SIZES,
    supportsBackground: false,
    supportsQuality: true,
    qualities: STANDARD_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1-mini",
    provider: "openai",
    label: "gpt-image-1-mini",
    sizing: "legacy",
    sizes: GPT_IMAGE_1_SIZES,
    supportsBackground: false,
    supportsQuality: true,
    qualities: STANDARD_QUALITIES,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gemini-3.1-flash-image",
    provider: "gemini",
    label: "Gemini 3.1 Flash Image",
    sizing: "ratio",
    sizes: GEMINI_FLASH_SIZES,
    supportsBackground: false,
    supportsQuality: false,
    qualities: [],
    supportsModeration: false,
    supportsEdit: true,
    maxImagesPerRequest: 1
  },
  {
    id: "gemini-3-pro-image",
    provider: "gemini",
    label: "Gemini 3 Pro Image",
    sizing: "ratio",
    sizes: GEMINI_COMMON_SIZES,
    supportsBackground: false,
    supportsQuality: false,
    qualities: [],
    supportsModeration: false,
    supportsEdit: true,
    maxImagesPerRequest: 1
  }
];

const BY_ID = new Map(MODEL_REGISTRY.map((model) => [model.id, model]));

export const DEFAULT_MODEL_ID = "gpt-image-2.5-sunburst";
export const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  openai: "gpt-image-2.5-sunburst",
  gemini: "gemini-3.1-flash-image"
};

export function providerIds(): string[] {
  return [...new Set(MODEL_REGISTRY.map((model) => model.provider))];
}

export function providerLabel(id: string): string {
  if (id === "openai") return "OpenAI";
  if (id === "gemini") return "Gemini";
  return id;
}

export function defaultModelForProvider(provider: string): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL_ID;
}

export function findModel(id: string): ModelInfo | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Falls back to the default model's capabilities for an unknown id rather than
 * throwing, so a stale saved setting degrades instead of breaking the UI. The
 * provider is what ultimately rejects a model it does not know.
 */
export function modelOrDefault(id: string): ModelInfo {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_MODEL_ID)!;
}

export function modelIds(): string[] {
  return MODEL_REGISTRY.map((model) => model.id);
}

export function modelsForProvider(provider: string): ModelInfo[] {
  return MODEL_REGISTRY.filter((model) => model.provider === provider);
}

export function qualitiesFor(model: ModelInfo): readonly ImageQuality[] {
  return model.supportsQuality ? model.qualities : (["auto"] as const);
}

/** Drop a quality the selected model cannot send, rather than 400 later. */
export function clampQuality(quality: ImageQuality, model: ModelInfo): ImageQuality {
  return qualitiesFor(model).includes(quality) ? quality : "auto";
}

export function clampGeneration(generation: GenerationParams): GenerationParams {
  const model = modelOrDefault(generation.model);
  const quality = clampQuality(generation.quality, model);
  const imageCount = Math.min(Math.max(1, generation.imageCount), model.maxImagesPerRequest);

  if (quality === generation.quality && imageCount === generation.imageCount) return generation;
  return { ...generation, quality, imageCount };
}

export function sizingMode(modelId: string): SizingMode {
  return modelOrDefault(modelId).sizing;
}

/** Snaps a requested size to what the given model will actually accept. */
export function snapRequestSize(requested: Size, modelId: string): Size {
  switch (sizingMode(modelId)) {
    case "flexible":
      return snapFlexibleSize(requested);
    case "ratio":
      return snapRatioSize(requested);
    case "legacy":
      return snapLegacySize(requested);
  }
}

export function sizeOptionId(option: Pick<SizeOption, "width" | "height">): string {
  return `${option.width}x${option.height}`;
}

export function matchSizeOption(model: ModelInfo, requested: Size): SizeOption | null {
  return (
    model.sizes.find((option) => option.width === requested.width && option.height === requested.height) ??
    null
  );
}

export function sizeSelection(generation: GenerationParams, model: ModelInfo): string {
  if (generation.useAutoSize) return "auto";
  const match = matchSizeOption(model, generation.size);
  return match ? sizeOptionId(match) : "custom";
}

export function sizePickerOptions(model: ModelInfo): { id: string; label: string }[] {
  return [
    { id: "auto", label: "auto" },
    ...model.sizes.map((option) => ({ id: sizeOptionId(option), label: option.label })),
    { id: "custom", label: "custom" }
  ];
}

export function applySizeSelection(
  selection: string,
  generation: GenerationParams,
  model: ModelInfo
): Partial<GenerationParams> {
  if (selection === "auto") return { useAutoSize: true };
  if (selection === "custom") return { useAutoSize: false };

  const match = model.sizes.find((option) => sizeOptionId(option) === selection);
  if (!match) return { useAutoSize: false };

  return { useAutoSize: false, size: { width: match.width, height: match.height } };
}

/** One-line hint under the picker. Null when there is nothing to add. */
export function describeRequestSize(
  model: ModelInfo,
  size: Size,
  useAutoSize: boolean
): string | null {
  if (useAutoSize) return null;

  if (model.sizing === "ratio") {
    const preset = matchSizeOption(model, size);
    if (preset?.aspectRatio && preset.imageSize) {
      return `Gemini will receive ${preset.aspectRatio} at ${preset.imageSize}.`;
    }
    const snapped = snapRatioRequest(size);
    return `Gemini will receive ${snapped.aspectRatio} at ${snapped.imageSize}.`;
  }

  const snapped = snapRequestSize(size, model.id);
  if (snapped.width === size.width && snapped.height === size.height) return null;
  return `The API will receive ${snapped.width}x${snapped.height} after snapping to its edge and total-pixel rules.`;
}
