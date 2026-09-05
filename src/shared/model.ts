import type { ProcessingSettings } from "@/core/settings";
import type { DitherMode, MaskSource, Size, TemplateFitMode } from "@/core/types";

export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageBackground = "auto" | "transparent" | "opaque";
export type ImageModeration = "auto" | "low";

export const MODELS = [
  "gpt-image-2",
  "gpt-image-2-2026-04-21",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini"
] as const;

export interface GenerationParams {
  model: string;
  quality: ImageQuality;
  background: ImageBackground;
  moderation: ImageModeration;
  size: Size;
  useAutoSize: boolean;
  imageCount: number;
}

export const DEFAULT_GENERATION: GenerationParams = {
  model: "gpt-image-2",
  quality: "auto",
  background: "transparent",
  moderation: "auto",
  size: { width: 1024, height: 1024 },
  useAutoSize: false,
  imageCount: 1
};

export interface PromptSpec {
  prefix: string;
  body: string;
  suffix: string;
}

export function composePrompt(prompt: PromptSpec): string {
  return [prompt.prefix, prompt.body, prompt.suffix]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export interface TemplateSpec {
  file: string;
  fit: TemplateFitMode;
  maskSource: MaskSource;
  matchAspect: boolean;
  dilatePixels: number;
  useAsMask: boolean;
}

export interface TokenUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AssetRecord {
  id: string;
  name: string;
  folder: string;
  tags: string[];
  createdAt: string;
  sourceFile: string;
  sourceWidth: number;
  sourceHeight: number;
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  processing: ProcessingSettings;
  processingDescription: string;
  approvedPath: string | null;
  approvedName: string | null;
  rerunOf: string | null;
  jobId: string | null;
  template: TemplateSpec | null;
  usage: TokenUsage | null;
  elapsedSeconds: number | null;
}

export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobRecord {
  id: string;
  status: JobStatus;
  label: string;
  batchId: string | null;
  batchIndex: number;
  batchSize: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  processing: ProcessingSettings;
  folder: string;
  template: TemplateSpec | null;
  rerunOf: string | null;
  assetIds: string[];
  resolvedSize: Size | null;
  error: string | null;
}

export interface StagedItem {
  id: string;
  assetId: string;
  x: number;
  y: number;
  footprint: Size;
  zIndex: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  showSource: boolean;
  opacity: number;
}

export interface RepeatGroup {
  id: string;
  assetIds: string[];
  x: number;
  y: number;
  cell: Size;
  marginX: number;
  marginY: number;
  countX: number;
  countY: number;
  fillX: boolean;
  fillY: boolean;
  randomRotate: boolean;
  background: string;
  zIndex: number;
  opacity: number;
  seed: number;
}

export interface Composition {
  id: string;
  name: string;
  updatedAt: string;
  unitsPerCell: number;
  camera: { x: number; y: number; zoom: number };
  items: StagedItem[];
  groups: RepeatGroup[];
  palettePool: string[];
  palette: string;
  paletteDither: DitherMode;
  paletteDitherStrength: number;
}

export interface StudioSettings {
  promptPrefix: string;
  promptSuffix: string;
  assetSlug: string;
  generation: GenerationParams;
  processing: ProcessingSettings;
  concurrency: number;
  activeCompositionId: string | null;
  cutTemplateBackgroundOnPaste: boolean;
  templateCutTolerance: number;
}
