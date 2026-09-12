import { NextResponse } from "next/server";
import {
  isPixelConstraintTemplate,
  pixelConstraintWindow
} from "@/core/pixelMask";
import { withDefaults } from "@/core/settings";
import { readDoc } from "@/db/repo/projectDoc";
import { KeyNotUsableError, resolveKeySelection } from "@/db/repo/providerKeys";
import { readSettings, writeSettings } from "@/db/repo/users";
import { providerForModel } from "@/providers";
import { clampGeneration, findModel } from "@/providers/models";
import { projectContext } from "@/server/access";
import {
  EmptyExpansionError,
  FanOutExceededError,
  InvalidInputsError,
  QuotaExceededError,
  enqueueGeneration
} from "@/server/generation";
import { generateBodySchema, parseBody, withValidation } from "@/server/validation";
import { docFromState, readProjectSettings } from "@/shared/doc";
import { normalizeLayoutGuideInputs } from "@/shared/featurePrompt";
import { composePrompt, type GenerationParams } from "@/shared/model";
import { isExpandingMultistep, shouldRememberGeneration } from "@/shared/multistep";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    // `generate` rather than `edit`: this is the call that spends the owner's
    // money, so it is gated separately from rearranging the scene.
    const { projectId, userId } = await projectContext(params, "generate");

    const body = await parseBody(request, generateBodySchema);
    const [settings, snapshot] = await Promise.all([
      readSettings(userId),
      readDoc(projectId)
    ]);

    // The wrapper is the project's, read from the document rather than taken
    // on trust from the body -- a client that has not synced yet would
    // otherwise quietly generate without the house style.
    const project = readProjectSettings(docFromState(snapshot.state));

    const prompt = {
      guide: body.promptGuide ?? "",
      prefix: body.promptPrefix ?? project.promptPrefix,
      body: body.promptBody,
      extra: body.promptExtra ?? "",
      suffix: body.promptSuffix ?? project.promptSuffix
    };

    const generation: GenerationParams = clampGeneration({
      ...settings.generation,
      ...(body.generation ?? {})
    });
    const processing = withDefaults({ ...settings.processing, ...(body.processing ?? {}) });
    const layout = normalizeLayoutGuideInputs({
      base: body.inputs?.base ?? null,
      mask: body.inputs?.mask ?? null
    });
    const pixelWindow =
      layout.mask?.source.kind === "template" &&
      isPixelConstraintTemplate(layout.mask.source.templateId)
        ? pixelConstraintWindow(layout.mask.window ?? processing.targetSize)
        : null;
    const inputs = body.inputs
      ? {
          ...body.inputs,
          base: layout.base,
          mask: pixelWindow && layout.mask ? { ...layout.mask, window: pixelWindow } : layout.mask
        }
      : null;

    // Generation and processing choices are the caller's own working
    // preferences, so they are remembered against them. The prompt wrapper is
    // the project's and lives in the document. The pixel-grid downsample is
    // attached at enqueue from the mask, not written into these defaults.
    const expanding = isExpandingMultistep(body.inputs);
    if (
      shouldRememberGeneration({
        remember: body.remember,
        sheet: Boolean(body.sequencePlan?.actions?.length),
        loop: expanding && Boolean(body.inputs?.loop),
        chunk: expanding && Boolean(body.inputs?.chunk)
      })
    ) {
      await writeSettings(userId, { generation, processing });
    }

    if (expanding && findModel(generation.model)?.supportsEdit === false) {
      return NextResponse.json({ error: "this model cannot edit an existing image" }, { status: 400 });
    }

    try {
      const providerKeyId = await resolveKeySelection(
        projectId,
        providerForModel(generation.model).id,
        body.providerKeyId
      );

      const jobs = await enqueueGeneration({
        projectId,
        userId,
        providerKeyId,
        prompt,
        generation,
        processing: processing,
        folder: body.folder ?? "",
        inputs,
        sequencePlan: body.sequencePlan ?? null,
        label: body.label,
        batches: body.batches ?? 1,
        variables: body.variables
      });

      return NextResponse.json({ jobs, composedPrompt: composePrompt(prompt) });
    } catch (error) {
      if (error instanceof KeyNotUsableError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof QuotaExceededError) {
        return NextResponse.json({ error: error.message }, { status: 402 });
      }
      if (
        error instanceof EmptyExpansionError ||
        error instanceof FanOutExceededError ||
        error instanceof InvalidInputsError
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  });
}
