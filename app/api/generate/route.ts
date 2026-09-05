import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { withDefaults } from "@/core/settings";
import { readSettings, serialize, writeSettings } from "@/server/library";
import { enqueue } from "@/server/queue";
import { composePrompt, type GenerationParams, type TemplateSpec } from "@/shared/model";
import type { ProcessingSettings } from "@/core/settings";

export const dynamic = "force-dynamic";

interface GenerateBody {
  promptBody: string;
  promptPrefix?: string;
  promptSuffix?: string;
  generation?: Partial<GenerationParams>;
  processing?: Partial<ProcessingSettings>;
  folder?: string;
  template?: TemplateSpec | null;
  label?: string;
  batches?: number;
  remember?: boolean;
}

export async function POST(request: Request) {
  const body = (await request.json()) as GenerateBody;

  if (!body.promptBody || body.promptBody.trim().length === 0) {
    return NextResponse.json({ error: "a prompt is required" }, { status: 400 });
  }

  const jobs = await serialize(() => {
    const settings = readSettings();

    const prompt = {
      prefix: body.promptPrefix ?? settings.promptPrefix,
      body: body.promptBody,
      suffix: body.promptSuffix ?? settings.promptSuffix
    };

    const generation: GenerationParams = { ...settings.generation, ...(body.generation ?? {}) };
    const processing = withDefaults({ ...settings.processing, ...(body.processing ?? {}) });

    if (body.remember !== false) {
      writeSettings({
        ...settings,
        promptPrefix: prompt.prefix,
        promptSuffix: prompt.suffix,
        generation,
        processing
      });
    }

    const count = Math.max(1, Math.min(20, Math.floor(body.batches ?? 1)));
    const batchId = count > 1 ? crypto.randomUUID() : null;

    return Array.from({ length: count }, (_unused, index) =>
      enqueue({
        prompt,
        generation,
        processing,
        folder: body.folder ?? "",
        template: body.template ?? null,
        label: body.label,
        batchId,
        batchIndex: index + 1,
        batchSize: count
      })
    );
  });

  return NextResponse.json({ jobs, composedPrompt: composePrompt(jobs[0].prompt) });
}
