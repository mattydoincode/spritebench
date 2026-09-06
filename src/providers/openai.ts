import type { GenerationParams, TokenUsage } from "@/shared/model";
import { asBytes, type Bytes } from "@/storage/types";
import { modelOrDefault, modelsForProvider, snapRequestSize } from "./models";
import {
  ProviderError,
  type EditRequest,
  type GenerateRequest,
  type ImageProvider,
  type ModelInfo,
  type ProviderErrorKind,
  type ProviderResult
} from "./types";

const GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const EDITS_URL = "https://api.openai.com/v1/images/edits";

const PROVIDER_ID = "openai";

interface OpenAIErrorBody {
  message?: unknown;
  code?: unknown;
  type?: unknown;
}

function buildParameters(
  prompt: string,
  generation: GenerationParams,
  overrideSize?: { width: number; height: number }
): Record<string, string | number> {
  const model = modelOrDefault(generation.model);

  const parameters: Record<string, string | number> = {
    model: generation.model,
    prompt,
    n: Math.max(1, generation.imageCount),
    output_format: "png"
  };

  if (model.supportsModeration) parameters.moderation = generation.moderation;

  if (overrideSize) {
    parameters.size = `${overrideSize.width}x${overrideSize.height}`;
  } else if (generation.useAutoSize) {
    parameters.size = "auto";
  } else {
    const snapped = snapRequestSize(generation.size, generation.model);
    parameters.size = `${snapped.width}x${snapped.height}`;
  }

  if (model.supportsQuality && generation.quality !== "auto") {
    parameters.quality = generation.quality;
  }

  if (model.supportsBackground && generation.background !== "auto") {
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

/**
 * Maps an OpenAI failure onto a provider-agnostic kind. The HTTP status is the
 * coarse signal; the error `code` refines it, because a 400 can be either a
 * malformed request or a moderation refusal and those need opposite retry
 * behavior.
 */
function classify(status: number, body: OpenAIErrorBody | null): ProviderErrorKind {
  const code = typeof body?.code === "string" ? body.code : "";
  const type = typeof body?.type === "string" ? body.type : "";
  const message = typeof body?.message === "string" ? body.message.toLowerCase() : "";

  const moderated =
    code === "moderation_blocked" ||
    code === "content_policy_violation" ||
    message.includes("safety system") ||
    message.includes("content policy");

  if (moderated) return "content_policy";

  if (status === 401 || status === 403) return "auth";
  if (status === 429) {
    return code === "insufficient_quota" || type === "insufficient_quota" ? "quota" : "rate_limit";
  }
  if (status === 408 || status === 409 || status >= 500) return "transient";
  if (status >= 400) return "invalid_request";

  return "transient";
}

function errorBody(payload: unknown): OpenAIErrorBody | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as Record<string, unknown>).error;

  return error && typeof error === "object" ? (error as OpenAIErrorBody) : null;
}

function fail(status: number, payload: unknown): never {
  const body = errorBody(payload);
  const message = typeof body?.message === "string" ? body.message : `HTTP ${status}`;

  throw new ProviderError(classify(status, body), message, {
    provider: PROVIDER_ID,
    status
  });
}

function readImages(payload: unknown): Bytes[] {
  const body = errorBody(payload);
  if (body) {
    // A 200 that still carries an error object.
    throw new ProviderError(
      classify(400, body),
      typeof body.message === "string" ? body.message : "OpenAI returned an error",
      { provider: PROVIDER_ID }
    );
  }

  const data = (payload as Record<string, unknown> | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new ProviderError("transient", "OpenAI returned no images", {
      provider: PROVIDER_ID
    });
  }

  const images: Bytes[] = [];
  for (const entry of data) {
    const b64 = (entry as Record<string, unknown>).b64_json;
    if (typeof b64 === "string") images.push(asBytes(Buffer.from(b64, "base64")));
  }

  if (images.length === 0) {
    throw new ProviderError("transient", "OpenAI response contained no b64_json image data", {
      provider: PROVIDER_ID
    });
  }

  return images;
}

async function send(
  url: string,
  init: RequestInit
): Promise<{ payload: unknown; elapsedSeconds: number }> {
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    // Connection reset, DNS, timeout: worth another attempt.
    throw new ProviderError("transient", "could not reach OpenAI", {
      provider: PROVIDER_ID,
      cause
    });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) fail(response.status, payload);

  return { payload, elapsedSeconds: (Date.now() - started) / 1000 };
}

function parseSize(value: string | number | undefined): { width: number; height: number } | null {
  if (value === "auto" || value === undefined) return null;
  const [width, height] = String(value).split("x");

  return { width: Number(width) || 0, height: Number(height) || 0 };
}

export const openAIProvider: ImageProvider = {
  id: PROVIDER_ID,

  models(): ModelInfo[] {
    return modelsForProvider(PROVIDER_ID);
  },

  async generate({ apiKey, prompt, generation }: GenerateRequest): Promise<ProviderResult> {
    const parameters = buildParameters(prompt, generation);

    const { payload, elapsedSeconds } = await send(GENERATIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(parameters)
    });

    return {
      images: readImages(payload),
      usage: parseUsage((payload as Record<string, unknown>).usage),
      elapsedSeconds,
      resolvedSize: parseSize(parameters.size)
    };
  },

  async edit({ apiKey, prompt, generation, base, mask, size }: EditRequest): Promise<ProviderResult> {
    const parameters = buildParameters(prompt, generation, size);

    const form = new FormData();
    for (const [key, value] of Object.entries(parameters)) form.append(key, String(value));

    form.append("image[]", new File([base], "base.png", { type: "image/png" }));
    if (mask) form.append("mask", new File([mask], "mask.png", { type: "image/png" }));

    const { payload, elapsedSeconds } = await send(EDITS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    return {
      images: readImages(payload),
      usage: parseUsage((payload as Record<string, unknown>).usage),
      elapsedSeconds,
      resolvedSize: size
    };
  }
};
