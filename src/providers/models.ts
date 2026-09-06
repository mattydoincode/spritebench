import { snapFlexibleSize, snapLegacySize } from "@/core/size";
import type { Size } from "@/core/types";
import type { ModelInfo, SizingMode } from "./types";

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
    id: "gpt-image-2",
    provider: "openai",
    label: "gpt-image-2",
    sizing: "flexible",
    supportsBackground: true,
    supportsQuality: true,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-2-2026-04-21",
    provider: "openai",
    label: "gpt-image-2 (pinned 2026-04-21)",
    sizing: "flexible",
    supportsBackground: true,
    supportsQuality: true,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1.5",
    provider: "openai",
    label: "gpt-image-1.5",
    sizing: "legacy",
    supportsBackground: false,
    supportsQuality: true,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1",
    provider: "openai",
    label: "gpt-image-1",
    sizing: "legacy",
    supportsBackground: false,
    supportsQuality: true,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  },
  {
    id: "gpt-image-1-mini",
    provider: "openai",
    label: "gpt-image-1-mini",
    sizing: "legacy",
    supportsBackground: false,
    supportsQuality: true,
    supportsModeration: true,
    supportsEdit: true,
    maxImagesPerRequest: 10
  }
];

const BY_ID = new Map(MODEL_REGISTRY.map((model) => [model.id, model]));

export const DEFAULT_MODEL_ID = "gpt-image-2";

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

export function sizingMode(modelId: string): SizingMode {
  return modelOrDefault(modelId).sizing;
}

/** Snaps a requested size to what the given model will actually accept. */
export function snapRequestSize(requested: Size, modelId: string): Size {
  return sizingMode(modelId) === "flexible"
    ? snapFlexibleSize(requested)
    : snapLegacySize(requested);
}
