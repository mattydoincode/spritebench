import { NextResponse } from "next/server";
import { withDefaults } from "@/core/settings";
import { currentUserId, readSettings, writeSettings } from "@/db/repo/users";
import {
  FanOutExceededError,
  QuotaExceededError,
  enqueueGeneration
} from "@/server/generation";
import { generateBodySchema, parseBody, withValidation } from "@/server/validation";
import { composePrompt, type GenerationParams } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withValidation(async () => {
    const body = await parseBody(request, generateBodySchema);
    const userId = await currentUserId();
    const settings = await readSettings(userId);

    const prompt = {
      prefix: body.promptPrefix ?? settings.promptPrefix,
      body: body.promptBody,
      suffix: body.promptSuffix ?? settings.promptSuffix
    };

    const generation: GenerationParams = { ...settings.generation, ...(body.generation ?? {}) };
    const processing = withDefaults({ ...settings.processing, ...(body.processing ?? {}) });

    if (body.remember !== false) {
      await writeSettings(userId, {
        promptPrefix: prompt.prefix,
        promptSuffix: prompt.suffix,
        generation,
        processing
      });
    }

    try {
      const jobs = await enqueueGeneration({
        userId,
        prompt,
        generation,
        processing,
        folder: body.folder ?? "",
        template: body.template ?? null,
        label: body.label,
        batches: body.batches ?? 1
      });

      return NextResponse.json({ jobs, composedPrompt: composePrompt(prompt) });
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return NextResponse.json({ error: error.message }, { status: 402 });
      }
      if (error instanceof FanOutExceededError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  });
}
