import sharp from "sharp";
import { flattenEditGuide } from "@/core/guide";
import { decodePng, encodePng } from "@/server/png";
import type { TokenUsage } from "@/shared/model";
import { asBytes, type Bytes } from "@/storage/types";
import { matchSizeOption, modelOrDefault, modelsForProvider } from "./models";
import { snapRatioRequest } from "./ratio";
import {
  ProviderError,
  type EditRequest,
  type GenerateRequest,
  type ImageProvider,
  type ModelInfo,
  type ProviderErrorKind,
  type ProviderResult
} from "./types";

const GENERATE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const PROVIDER_ID = "gemini";


interface GeminiErrorBody {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

interface GeminiPart {
  text?: unknown;
  inlineData?: { mimeType?: unknown; data?: unknown };
}

function errorBody(payload: unknown): GeminiErrorBody | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>).error;
  return error && typeof error === "object" ? (error as GeminiErrorBody) : null;
}

function errorMessage(payload: unknown): string {
  const body = errorBody(payload);
  return typeof body?.message === "string" ? body.message : "";
}

/**
 * Maps a Gemini failure onto a provider-agnostic kind. Google puts the
 * coarse signal in HTTP status and a `status` string; safety refusals also
 * arrive as a 200 with `promptFeedback` or `finishReason`, which is handled
 * before this is called.
 */
function classify(status: number, payload: unknown): ProviderErrorKind {
  const body = errorBody(payload);
  const code = typeof body?.status === "string" ? body.status : "";
  const message = errorMessage(payload).toLowerCase();

  const moderated =
    code === "FAILED_PRECONDITION" ||
    message.includes("safety") ||
    message.includes("blocked") ||
    message.includes("prohibited") ||
    message.includes("harm");

  if (moderated) return "content_policy";

  if (status === 401 || status === 403 || code === "UNAUTHENTICATED" || code === "PERMISSION_DENIED") {
    return "auth";
  }

  if (status === 429 || code === "RESOURCE_EXHAUSTED") {
    return message.includes("quota") || message.includes("billing") ? "quota" : "rate_limit";
  }

  if (
    status === 408 ||
    status >= 500 ||
    code === "UNAVAILABLE" ||
    code === "INTERNAL" ||
    code === "DEADLINE_EXCEEDED"
  ) {
    return "transient";
  }

  if (status >= 400) return "invalid_request";
  return "transient";
}

function fail(status: number, payload: unknown): never {
  throw new ProviderError(classify(status, payload), errorMessage(payload) || `HTTP ${status}`, {
    provider: PROVIDER_ID,
    status
  });
}

function finishReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const reason = (candidates[0] as Record<string, unknown> | undefined)?.finishReason;
  return typeof reason === "string" ? reason : "";
}

function blockReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const feedback = (payload as Record<string, unknown>).promptFeedback;
  if (!feedback || typeof feedback !== "object") return "";
  const reason = (feedback as Record<string, unknown>).blockReason;
  return typeof reason === "string" ? reason : "";
}

function isSafety(reason: string): boolean {
  return (
    reason === "SAFETY" ||
    reason === "IMAGE_SAFETY" ||
    reason === "PROHIBITED_CONTENT" ||
    reason === "BLOCKLIST"
  );
}

function parseUsage(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== "object") return null;
  const usage = (payload as Record<string, unknown>).usageMetadata;
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;

  return {
    totalTokens: Number(record.totalTokenCount ?? 0),
    inputTokens: Number(record.promptTokenCount ?? 0),
    outputTokens: Number(record.candidatesTokenCount ?? 0)
  };
}

async function toPng(bytes: Buffer, mimeType: string): Promise<Bytes> {
  if (mimeType === "image/png" || mimeType === "") return asBytes(bytes);
  return asBytes(await sharp(bytes).png().toBuffer());
}

function partsOf(payload: unknown): GeminiPart[] {
  if (!payload || typeof payload !== "object") return [];
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates)) return [];

  const found: GeminiPart[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as Record<string, unknown>).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part && typeof part === "object") found.push(part as GeminiPart);
    }
  }

  return found;
}

async function readImages(payload: unknown): Promise<Bytes[]> {
  const blocked = blockReason(payload);
  if (isSafety(blocked)) {
    throw new ProviderError("content_policy", `Gemini blocked the prompt (${blocked})`, {
      provider: PROVIDER_ID
    });
  }

  const finished = finishReason(payload);
  if (isSafety(finished)) {
    throw new ProviderError("content_policy", `Gemini refused the image (${finished})`, {
      provider: PROVIDER_ID
    });
  }

  const images: Bytes[] = [];
  for (const part of partsOf(payload)) {
    const data = part.inlineData?.data;
    if (typeof data !== "string" || data.length === 0) continue;
    const mime = typeof part.inlineData?.mimeType === "string" ? part.inlineData.mimeType : "";
    images.push(await toPng(Buffer.from(data, "base64"), mime));
  }

  if (images.length === 0) {
    throw new ProviderError("transient", "Gemini returned no images", {
      provider: PROVIDER_ID
    });
  }

  return images;
}

function imageConfig(generation: GenerateRequest["generation"]) {
  if (generation.useAutoSize) return undefined;
  const preset = matchSizeOption(modelOrDefault(generation.model), generation.size);
  if (preset?.aspectRatio && preset.imageSize) {
    return { aspectRatio: preset.aspectRatio, imageSize: preset.imageSize };
  }
  const snapped = snapRatioRequest(generation.size);
  return { aspectRatio: snapped.aspectRatio, imageSize: snapped.imageSize };
}

function resolvedSize(generation: GenerateRequest["generation"]) {
  if (generation.useAutoSize) return null;
  const preset = matchSizeOption(modelOrDefault(generation.model), generation.size);
  if (preset) return { width: preset.width, height: preset.height };
  return snapRatioRequest(generation.size).size;
}

function bodyFor(prompt: string, generation: GenerateRequest["generation"], images: { mimeType: string; data: string }[]) {
  const parts: Record<string, unknown>[] = [];
  for (const image of images) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  parts.push({ text: prompt });

  const config: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"]
  };
  const sized = imageConfig(generation);
  if (sized) config.imageConfig = sized;

  return {
    contents: [{ role: "user", parts }],
    generationConfig: config
  };
}

async function send(
  model: string,
  apiKey: string,
  body: unknown
): Promise<{ payload: unknown; elapsedSeconds: number }> {
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(GENERATE_URL(model), {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    throw new ProviderError("transient", "could not reach Gemini", {
      provider: PROVIDER_ID,
      cause
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) fail(response.status, payload);

  const nested = errorBody(payload);
  if (nested) fail(typeof nested.code === "number" ? nested.code : 400, payload);

  return { payload, elapsedSeconds: (Date.now() - started) / 1000 };
}

export const geminiProvider: ImageProvider = {
  id: PROVIDER_ID,

  models(): ModelInfo[] {
    return modelsForProvider(PROVIDER_ID);
  },

  async generate({ apiKey, prompt, generation }: GenerateRequest): Promise<ProviderResult> {
    const { payload, elapsedSeconds } = await send(
      generation.model,
      apiKey,
      bodyFor(prompt, generation, [])
    );

    return {
      images: await readImages(payload),
      usage: parseUsage(payload),
      elapsedSeconds,
      resolvedSize: resolvedSize(generation)
    };
  },

  async edit({ apiKey, prompt, generation, base, mask, plate, size }: EditRequest): Promise<ProviderResult> {
    const images = plate
      ? [
          { mimeType: "image/png", data: Buffer.from(base).toString("base64") },
          { mimeType: "image/png", data: Buffer.from(plate).toString("base64") }
        ]
      : [
          {
            mimeType: "image/png",
            data: (mask
              ? encodePng(flattenEditGuide(decodePng(Buffer.from(base)), decodePng(Buffer.from(mask))))
              : Buffer.from(base)
            ).toString("base64")
          }
        ];
    const { payload, elapsedSeconds } = await send(
      generation.model,
      apiKey,
      bodyFor(prompt, { ...generation, size, useAutoSize: false }, images)
    );

    return {
      images: await readImages(payload),
      usage: parseUsage(payload),
      elapsedSeconds,
      resolvedSize: size
    };
  }
};
