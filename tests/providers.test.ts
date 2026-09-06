import { afterEach, describe, expect, it, vi } from "vitest";
import { providerForModel } from "@/providers";
import { MODEL_REGISTRY, findModel, modelIds, modelOrDefault } from "@/providers/models";
import { openAIProvider } from "@/providers/openai";
import { ProviderError, isRetryable, type ProviderErrorKind } from "@/providers/types";
import { DEFAULT_GENERATION } from "@/shared/model";
import { asBytes } from "@/storage/types";

const request = {
  apiKey: "sk-test",
  prompt: "a wooden crate",
  generation: DEFAULT_GENERATION
};

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}

/** One pixel of transparent PNG is enough; the provider never decodes it. */
function pngBytes() {
  return asBytes(Buffer.from("89504e470d0a1a0a", "hex"));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model registry", () => {
  it("has no duplicate ids", () => {
    expect(new Set(modelIds()).size).toBe(MODEL_REGISTRY.length);
  });

  it("names a provider that exists for every model", () => {
    for (const model of MODEL_REGISTRY) {
      expect(providerForModel(model.id).id).toBe(model.provider);
    }
  });

  it("returns null for an unknown model but still yields defaults", () => {
    expect(findModel("nope")).toBeNull();
    expect(modelOrDefault("nope").id).toBe("gpt-image-2");
  });
});

describe("error classification", () => {
  const cases: { status: number; body: unknown; kind: ProviderErrorKind }[] = [
    { status: 401, body: { error: { message: "bad key" } }, kind: "auth" },
    { status: 403, body: { error: { message: "forbidden" } }, kind: "auth" },
    { status: 429, body: { error: { message: "slow down" } }, kind: "rate_limit" },
    {
      status: 429,
      body: { error: { message: "no credit", code: "insufficient_quota" } },
      kind: "quota"
    },
    { status: 500, body: { error: { message: "oops" } }, kind: "transient" },
    { status: 503, body: { error: { message: "busy" } }, kind: "transient" },
    { status: 400, body: { error: { message: "bad size" } }, kind: "invalid_request" },
    {
      status: 400,
      body: { error: { message: "rejected", code: "moderation_blocked" } },
      kind: "content_policy"
    },
    {
      status: 400,
      body: { error: { message: "Your request was rejected by our safety system" } },
      kind: "content_policy"
    }
  ];

  for (const { status, body, kind } of cases) {
    it(`maps HTTP ${status} to ${kind}`, async () => {
      respond(status, body);

      const error = await openAIProvider.generate(request).catch((thrown) => thrown);

      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).kind).toBe(kind);
      expect((error as ProviderError).status).toBe(status);
    });
  }

  it("treats an unreachable provider as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );

    const error = await openAIProvider.generate(request).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("transient");
    expect(isRetryable(error)).toBe(true);
  });
});

describe("retry policy", () => {
  it("only retries failures a retry could fix", () => {
    const retryable: ProviderErrorKind[] = ["rate_limit", "transient"];
    const permanent: ProviderErrorKind[] = [
      "auth",
      "content_policy",
      "invalid_request",
      "quota"
    ];

    for (const kind of retryable) {
      expect(isRetryable(new ProviderError(kind, "x", { provider: "openai" }))).toBe(true);
    }

    for (const kind of permanent) {
      expect(isRetryable(new ProviderError(kind, "x", { provider: "openai" }))).toBe(false);
    }
  });

  it("does not retry errors from our own code", () => {
    expect(isRetryable(new Error("bug in the worker"))).toBe(false);
    expect(isRetryable("not even an error")).toBe(false);
  });
});

describe("request shaping", () => {
  async function capture(
    generation: Partial<typeof DEFAULT_GENERATION>
  ): Promise<Record<string, unknown>> {
    const seen: { body?: string } = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.body = init.body as string;
        return new Response(
          JSON.stringify({ data: [{ b64_json: "AAAA" }], usage: { total_tokens: 5 } }),
          { status: 200 }
        );
      })
    );

    await openAIProvider.generate({
      ...request,
      generation: { ...DEFAULT_GENERATION, ...generation }
    });

    return JSON.parse(seen.body ?? "{}");
  }

  it("sends a background only for models that support one", async () => {
    const flexible = await capture({ model: "gpt-image-2", background: "transparent" });
    expect(flexible.background).toBe("transparent");

    const legacy = await capture({ model: "gpt-image-1", background: "transparent" });
    expect(legacy.background).toBeUndefined();
  });

  it("omits an auto background even where it is supported", async () => {
    const body = await capture({ model: "gpt-image-2", background: "auto" });
    expect(body.background).toBeUndefined();
  });

  it("snaps the size according to the model's sizing mode", async () => {
    const flexible = await capture({
      model: "gpt-image-2",
      size: { width: 1920, height: 1080 }
    });
    expect(flexible.size).toBe("1920x1088");

    const legacy = await capture({ model: "gpt-image-1", size: { width: 1920, height: 1080 } });
    expect(legacy.size).toBe("1536x1024");
  });

  it("passes auto through instead of snapping", async () => {
    const body = await capture({ useAutoSize: true });
    expect(body.size).toBe("auto");
  });

  it("reports the resolved size, and null when the model chose it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 })
      )
    );

    const fixed = await openAIProvider.generate(request);
    expect(fixed.resolvedSize).toEqual({ width: 1024, height: 1024 });

    const auto = await openAIProvider.generate({
      ...request,
      generation: { ...DEFAULT_GENERATION, useAutoSize: true }
    });
    expect(auto.resolvedSize).toBeNull();
  });
});

describe("edit", () => {
  it("sends the base and mask as bytes, and echoes the conformed size", async () => {
    const seen: { form?: FormData } = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.form = init.body as FormData;
        return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
      })
    );

    const size = { width: 1024, height: 1536 };
    const result = await openAIProvider.edit({
      ...request,
      base: pngBytes(),
      mask: pngBytes(),
      size
    });

    expect(seen.form?.get("image[]")).toBeInstanceOf(File);
    expect(seen.form?.get("mask")).toBeInstanceOf(File);
    expect(seen.form?.get("size")).toBe("1024x1536");
    expect(result.resolvedSize).toEqual(size);
  });

  it("omits the mask when there is none", async () => {
    const seen: { form?: FormData } = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.form = init.body as FormData;
        return new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 });
      })
    );

    await openAIProvider.edit({
      ...request,
      base: pngBytes(),
      mask: null,
      size: { width: 1024, height: 1024 }
    });

    expect(seen.form?.get("mask")).toBeNull();
  });
});

describe("response reading", () => {
  it("decodes every returned image", async () => {
    respond(200, {
      data: [{ b64_json: Buffer.from("one").toString("base64") }, { b64_json: Buffer.from("two").toString("base64") }]
    });

    const result = await openAIProvider.generate(request);

    expect(result.images).toHaveLength(2);
    expect(Buffer.from(result.images[0]).toString()).toBe("one");
  });

  it("reads token usage when present", async () => {
    respond(200, {
      data: [{ b64_json: "AAAA" }],
      usage: { total_tokens: 30, input_tokens: 10, output_tokens: 20 }
    });

    expect((await openAIProvider.generate(request)).usage).toEqual({
      totalTokens: 30,
      inputTokens: 10,
      outputTokens: 20
    });
  });

  it("treats a 200 carrying an error object as a failure", async () => {
    respond(200, { error: { message: "rejected", code: "moderation_blocked" } });

    const error = await openAIProvider.generate(request).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("content_policy");
    expect(isRetryable(error)).toBe(false);
  });

  it("rejects an empty data array", async () => {
    respond(200, { data: [] });
    await expect(openAIProvider.generate(request)).rejects.toThrow(/no images/);
  });
});
