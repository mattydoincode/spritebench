import fs from "node:fs";
import path from "node:path";
import { snapRequestSize } from "@/core/size";
import type { Size } from "@/core/types";
import type { GenerationParams, TokenUsage } from "@/shared/model";
import { openAiApiKey } from "./env";

const GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const EDITS_URL = "https://api.openai.com/v1/images/edits";

const BACKGROUND_CAPABLE_MODELS = new Set(["gpt-image-2", "gpt-image-2-2026-04-21"]);

export interface GenerateResult {
  images: Buffer[];
  usage: TokenUsage | null;
  elapsedSeconds: number;
  resolvedSize: Size | null;
}

function buildParameters(
  prompt: string,
  generation: GenerationParams,
  overrideSize?: Size
): Record<string, string | number> {
  const parameters: Record<string, string | number> = {
    model: generation.model,
    prompt,
    n: Math.max(1, generation.imageCount),
    output_format: "png",
    moderation: generation.moderation
  };

  if (overrideSize) {
    parameters.size = `${overrideSize.width}x${overrideSize.height}`;
  } else if (generation.useAutoSize) {
    parameters.size = "auto";
  } else {
    const snapped = snapRequestSize(generation.size, generation.model);
    parameters.size = `${snapped.width}x${snapped.height}`;
  }

  if (generation.quality !== "auto") parameters.quality = generation.quality;

  if (generation.background !== "auto" && BACKGROUND_CAPABLE_MODELS.has(generation.model)) {
    parameters.background = generation.background;
  }

  return parameters;
}

function parseUsage(usage: unknown): TokenUsage | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;

  return {
    totalTokens: Number(record.total_tokens ?? 0),
    inputTokens: Number(record.input_tokens ?? 0),
    outputTokens: Number(record.output_tokens ?? 0)
  };
}

function readResponse(payload: unknown): Buffer[] {
  const record = payload as Record<string, unknown>;

  if (record.error && typeof record.error === "object") {
    const message = (record.error as Record<string, unknown>).message;
    throw new Error(typeof message === "string" ? message : "OpenAI returned an error");
  }

  const data = record.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("OpenAI returned no images");
  }

  const images: Buffer[] = [];
  for (const entry of data) {
    const b64 = (entry as Record<string, unknown>).b64_json;
    if (typeof b64 === "string") images.push(Buffer.from(b64, "base64"));
  }

  if (images.length === 0) throw new Error("OpenAI response contained no b64_json image data");
  return images;
}

export async function generateImages(
  prompt: string,
  generation: GenerationParams
): Promise<GenerateResult> {
  const started = Date.now();
  const parameters = buildParameters(prompt, generation);

  const response = await fetch(GENERATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(parameters)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as Record<string, Record<string, unknown>>).error?.message as string)
        : `HTTP ${response.status}`;
    throw new Error(message ?? `HTTP ${response.status}`);
  }

  const [width, height] = String(parameters.size ?? "x").split("x");

  return {
    images: readResponse(payload),
    usage: parseUsage((payload as Record<string, unknown>).usage),
    elapsedSeconds: (Date.now() - started) / 1000,
    resolvedSize:
      parameters.size === "auto"
        ? null
        : { width: Number(width) || 0, height: Number(height) || 0 }
  };
}

export async function editImage(
  prompt: string,
  generation: GenerationParams,
  basePath: string,
  maskPath: string | null,
  conformedSize: Size
): Promise<GenerateResult> {
  const started = Date.now();
  const parameters = buildParameters(prompt, generation, conformedSize);

  const form = new FormData();
  for (const [key, value] of Object.entries(parameters)) form.append(key, String(value));

  const baseBytes = fs.readFileSync(basePath);
  form.append(
    "image[]",
    new File([new Uint8Array(baseBytes)], path.basename(basePath), { type: "image/png" })
  );

  if (maskPath) {
    const maskBytes = fs.readFileSync(maskPath);
    form.append(
      "mask",
      new File([new Uint8Array(maskBytes)], path.basename(maskPath), { type: "image/png" })
    );
  }

  const response = await fetch(EDITS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiApiKey()}` },
    body: form
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? ((payload as Record<string, Record<string, unknown>>).error?.message as string)
        : `HTTP ${response.status}`;
    throw new Error(message ?? `HTTP ${response.status}`);
  }

  return {
    images: readResponse(payload),
    usage: parseUsage((payload as Record<string, unknown>).usage),
    elapsedSeconds: (Date.now() - started) / 1000,
    resolvedSize: conformedSize
  };
}
