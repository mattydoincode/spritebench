import { afterEach, describe, expect, it, vi } from "vitest";
import { providerForModel } from "@/providers";
import { geminiProvider } from "@/providers/gemini";
import {
  MODEL_REGISTRY,
  applySizeSelection,
  clampGeneration,
  describeRequestSize,
  findModel,
  modelIds,
  modelOrDefault,
  providerIds,
  sizeSelection
} from "@/providers/models";
import { openAIProvider } from "@/providers/openai";
import { ProviderError, isRetryable, type ProviderErrorKind } from "@/providers/types";
import { flattenEditGuide } from "@/core/guide";
import { createImage } from "@/core/pixels";
import { decodePng, encodePng } from "@/server/png";
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

/** One pixel of transparent PNG is enough; OpenAI never decodes it. */
function pngBytes() {
  return asBytes(Buffer.from("89504e470d0a1a0a", "hex"));
}

function rgbaPng(fill: (image: ReturnType<typeof createImage>) => void) {
  const image = createImage(2, 1);
  fill(image);
  return asBytes(encodePng(image));
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

  it("lists every provider that has models", () => {
    expect(providerIds()).toEqual(["openai", "gemini"]);
  });

  it("returns null for an unknown model but still yields defaults", () => {
    expect(findModel("nope")).toBeNull();
    expect(modelOrDefault("nope").id).toBe("gpt-image-2.5-sunburst");
  });

  it("offers xhigh and max only on GPT Image 2.5", () => {
    expect(findModel("gpt-image-2.5-sunburst")?.qualities).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]);
    expect(findModel("gpt-image-2.5-flare")?.qualities).toContain("xhigh");
    expect(findModel("gpt-image-2")?.qualities).toEqual(["auto", "low", "medium", "high"]);
  });

  it("clamps an unsupported quality down to auto", () => {
    expect(
      clampGeneration({ ...DEFAULT_GENERATION, model: "gpt-image-2", quality: "xhigh" }).quality
    ).toBe("auto");
    expect(
      clampGeneration({ ...DEFAULT_GENERATION, model: "gpt-image-2.5-flare", quality: "max" })
        .quality
    ).toBe("max");
  });

  it("lists GPT Image 2.5's official common sizes", () => {
    expect(findModel("gpt-image-2.5-sunburst")?.sizes.map((entry) => `${entry.width}x${entry.height}`)).toEqual([
      "1024x1024",
      "1536x1024",
      "1024x1536",
      "2048x2048",
      "2048x1152",
      "3840x2160",
      "2160x3840"
    ]);
  });

  it("treats a listed size as a preset and anything else as custom", () => {
    const model = findModel("gpt-image-2.5-sunburst")!;
    expect(sizeSelection({ ...DEFAULT_GENERATION, size: { width: 2048, height: 1152 } }, model)).toBe(
      "2048x1152"
    );
    expect(sizeSelection({ ...DEFAULT_GENERATION, size: { width: 1920, height: 1080 } }, model)).toBe(
      "custom"
    );
    expect(sizeSelection({ ...DEFAULT_GENERATION, useAutoSize: true }, model)).toBe("auto");
    expect(applySizeSelection("3840x2160", DEFAULT_GENERATION, model)).toEqual({
      useAutoSize: false,
      size: { width: 3840, height: 2160 }
    });
  });

  it("does not hint when a flexible size is already legal", () => {
    const model = findModel("gpt-image-2.5-sunburst")!;
    expect(describeRequestSize(model, { width: 1024, height: 1024 }, false)).toBeNull();
    expect(describeRequestSize(model, { width: 1920, height: 1080 }, false)).toMatch(/1920x1088/);
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

  it("sends xhigh on 2.5 and drops it on older models", async () => {
    const next = await capture({ model: "gpt-image-2.5-sunburst", quality: "xhigh" });
    expect(next.quality).toBe("xhigh");

    const legacy = await capture({ model: "gpt-image-2", quality: "xhigh" });
    expect(legacy.quality).toBeUndefined();
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

  it("sends the character and the plate as two images", async () => {
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
      mask: pngBytes(),
      plate: pngBytes(),
      size: { width: 1024, height: 1024 }
    });

    expect(seen.form?.getAll("image[]")).toHaveLength(2);
    expect(seen.form?.get("mask")).toBeInstanceOf(File);
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

const geminiRequest = {
  apiKey: "AIza-test",
  prompt: "a wooden crate",
  generation: { ...DEFAULT_GENERATION, model: "gemini-3.1-flash-image" }
};

function geminiOk(data = "AAAA") {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: "image/png", data } }]
        }
      }
    ],
    usageMetadata: { totalTokenCount: 30, promptTokenCount: 10, candidatesTokenCount: 20 }
  };
}

describe("gemini request shaping", () => {
  async function capture(
    generation: Partial<typeof DEFAULT_GENERATION>
  ): Promise<{ url: string; body: Record<string, unknown> }> {
    const seen: { url?: string; body?: string } = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.url = url;
        seen.body = init.body as string;
        return new Response(JSON.stringify(geminiOk()), { status: 200 });
      })
    );

    await geminiProvider.generate({
      ...geminiRequest,
      generation: { ...geminiRequest.generation, ...generation }
    });

    return { url: seen.url ?? "", body: JSON.parse(seen.body ?? "{}") };
  }

  it("calls generateContent on the chosen model", async () => {
    const { url } = await capture({});
    expect(url).toContain("/models/gemini-3.1-flash-image:generateContent");
  });

  it("sends an aspect and bucket, never a pixel size", async () => {
    const { body } = await capture({ size: { width: 1920, height: 1080 } });
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
    expect(config.responseModalities).toEqual(["TEXT", "IMAGE"]);
  });

  it("uses a listed Gemini size's official aspect and bucket", async () => {
    const { body } = await capture({ size: { width: 512, height: 512 } });
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.imageConfig).toEqual({ aspectRatio: "1:1", imageSize: "512" });
  });

  it("omits imageConfig when the model picks the size", async () => {
    const { body } = await capture({ useAutoSize: true });
    expect((body.generationConfig as Record<string, unknown>).imageConfig).toBeUndefined();
  });

  it("reports the snapped size, and null when the model chose it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(geminiOk()), { status: 200 }))
    );

    const fixed = await geminiProvider.generate(geminiRequest);
    expect(fixed.resolvedSize).toEqual({ width: 1024, height: 1024 });

    const auto = await geminiProvider.generate({
      ...geminiRequest,
      generation: { ...geminiRequest.generation, useAutoSize: true }
    });
    expect(auto.resolvedSize).toBeNull();
  });
});

describe("gemini errors", () => {
  it("maps HTTP 429 without a quota mention to rate_limit", async () => {
    respond(429, { error: { message: "slow down", status: "RESOURCE_EXHAUSTED" } });
    const error = await geminiProvider.generate(geminiRequest).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("rate_limit");
  });

  it("maps a billing 429 to quota", async () => {
    respond(429, { error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED" } });
    const error = await geminiProvider.generate(geminiRequest).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("quota");
  });

  it("treats a safety finish as a content policy refusal", async () => {
    respond(200, { candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] });
    const error = await geminiProvider.generate(geminiRequest).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("content_policy");
    expect(isRetryable(error)).toBe(false);
  });

  it("treats an unreachable provider as transient", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );

    const error = await geminiProvider.generate(geminiRequest).catch((thrown) => thrown);
    expect((error as ProviderError).kind).toBe("transient");
    expect(isRetryable(error)).toBe(true);
  });
});

describe("gemini edit", () => {
  it("sends one flattened guide and tells Gemini that white is empty", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const base = rgbaPng((image) => {
      image.data.set([10, 20, 30, 255, 40, 50, 60, 255]);
    });
    const mask = rgbaPng((image) => {
      image.data[3] = 0;
      image.data[7] = 255;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(geminiOk()), { status: 200 });
      })
    );

    await geminiProvider.edit({
      ...geminiRequest,
      base,
      mask,
      size: { width: 1024, height: 1024 }
    });

    const parts = (seen.body?.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]
      .parts;
    const images = parts.filter((part) => part.inlineData);
    expect(images).toHaveLength(1);
    expect(parts.at(-1)?.text).toBe(geminiRequest.prompt);
    expect(parts.at(-1)?.text).not.toMatch(/inpainting mask/);

    const sent = decodePng(
      Buffer.from(
        ((images[0].inlineData as { data: string }).data),
        "base64"
      )
    );
    expect(sent.data).toEqual(
      flattenEditGuide(decodePng(Buffer.from(base)), decodePng(Buffer.from(mask))).data
    );
  });

  it("sends the base alone when there is no mask", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const base = rgbaPng((image) => image.data.set([1, 2, 3, 255, 4, 5, 6, 255]));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(geminiOk()), { status: 200 });
      })
    );

    await geminiProvider.edit({
      ...geminiRequest,
      base,
      mask: null,
      size: { width: 1024, height: 1024 }
    });

    const parts = (seen.body?.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]
      .parts;
    expect(parts.filter((part) => part.inlineData)).toHaveLength(1);
    expect(parts.at(-1)?.text).toBe(geminiRequest.prompt);
  });

  it("sends the character and the plate as two images instead of flattening", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    const base = rgbaPng((image) => image.data.set([10, 20, 30, 255, 40, 50, 60, 255]));
    const plate = rgbaPng((image) => image.data.set([88, 88, 88, 255, 168, 168, 168, 255]));
    const mask = rgbaPng((image) => {
      image.data[3] = 0;
      image.data[7] = 255;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(geminiOk()), { status: 200 });
      })
    );

    await geminiProvider.edit({
      ...geminiRequest,
      base,
      mask,
      plate,
      size: { width: 1024, height: 1024 }
    });

    const parts = (seen.body?.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]
      .parts;
    const images = parts.filter((part) => part.inlineData);
    expect(images).toHaveLength(2);

    const first = decodePng(
      Buffer.from((images[0].inlineData as { data: string }).data, "base64")
    );
    const second = decodePng(
      Buffer.from((images[1].inlineData as { data: string }).data, "base64")
    );
    expect(first.data).toEqual(decodePng(Buffer.from(base)).data);
    expect(second.data).toEqual(decodePng(Buffer.from(plate)).data);
  });
});

describe("gemini response reading", () => {
  it("decodes inline image data and token usage", async () => {
    respond(200, geminiOk(Buffer.from("one").toString("base64")));

    const result = await geminiProvider.generate(geminiRequest);
    expect(Buffer.from(result.images[0]).toString()).toBe("one");
    expect(result.usage).toEqual({
      totalTokens: 30,
      inputTokens: 10,
      outputTokens: 20
    });
  });
});
