import type { Size } from "@/core/types";
import type { GenerationParams, TokenUsage } from "@/shared/model";
import type { Bytes } from "@/storage/types";

/**
 * How a model wants its request size expressed. `flexible` models accept any
 * edge that is a multiple of 16 within a total-pixel budget; `legacy` models
 * accept only a fixed set of sizes.
 */
export type SizingMode = "flexible" | "legacy";

export interface ModelInfo {
  id: string;
  provider: string;
  label: string;
  sizing: SizingMode;
  /** Whether an explicit transparent/opaque background can be requested. */
  supportsBackground: boolean;
  supportsQuality: boolean;
  supportsModeration: boolean;
  /** Whether the model can edit an existing image, which templates require. */
  supportsEdit: boolean;
  maxImagesPerRequest: number;
}

/**
 * Provider failures normalized so retry policy lives in one place instead of
 * being reimplemented per provider. Only `transient` and `rate_limit` are
 * worth retrying: a content-policy rejection is deterministic, and retrying
 * it just burns the user's quota on the same refusal.
 */
export type ProviderErrorKind =
  | "auth"
  | "rate_limit"
  | "content_policy"
  | "invalid_request"
  | "quota"
  | "transient";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit",
  "transient"
]);

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: { provider: string; status?: number | null; cause?: unknown } = {
      provider: "unknown"
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = options.provider;
    this.status = options.status ?? null;
    this.retryable = RETRYABLE.has(kind);
  }
}

export function isRetryable(error: unknown): boolean {
  // A non-provider error is something in our own code, and repeating it will
  // fail the same way.
  return error instanceof ProviderError && error.retryable;
}

export interface GenerateRequest {
  apiKey: string;
  prompt: string;
  generation: GenerationParams;
}

export interface EditRequest extends GenerateRequest {
  /** PNG bytes rather than a path, so concurrent jobs cannot collide. */
  base: Bytes;
  mask: Bytes | null;
  size: Size;
}

export interface ProviderResult {
  images: Bytes[];
  usage: TokenUsage | null;
  elapsedSeconds: number;
  /** Null when the model chose the size and did not report it back. */
  resolvedSize: Size | null;
}

export interface ImageProvider {
  readonly id: string;
  models(): ModelInfo[];
  generate(request: GenerateRequest): Promise<ProviderResult>;
  edit(request: EditRequest): Promise<ProviderResult>;
}
