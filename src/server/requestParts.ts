import { NextResponse } from "next/server";
import type { GenerationParams, JobInputs, PromptSpec, SequencePlan } from "@/shared/model";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerPromptSections,
  type AttachmentRole
} from "@/shared/providerPrompt";
import { providerAttachmentBytes } from "./providerRequest";

const ATTACHMENT_IDS = new Set<AttachmentRole>(["guide", "reference", "base", "mask", "start"]);

export type RequestJob = {
  prompt: PromptSpec;
  composedPrompt: string;
  generation: GenerationParams;
  inputs?: JobInputs | null;
  sequencePlan?: SequencePlan | null;
};

/**
 * Prompt text plus reconstructed reference / mask / layout-guide images for
 * a stored job or finished asset. Same bytes the provider call used (or will).
 */
export async function requestPartResponse(
  projectId: string,
  job: RequestJob,
  part: string | null
): Promise<NextResponse> {
  const input = {
    prompt: job.prompt,
    composedPrompt: job.composedPrompt,
    generation: job.generation,
    inputs: job.inputs,
    sequencePlan: job.sequencePlan
  };

  if (part) {
    if (!ATTACHMENT_IDS.has(part as AttachmentRole)) {
      return NextResponse.json({ error: "unknown request part" }, { status: 400 });
    }

    const bytes = await providerAttachmentBytes(projectId, job, part as AttachmentRole);
    if (!bytes) return NextResponse.json({ error: "that part was not sent" }, { status: 404 });

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600"
      }
    });
  }

  return NextResponse.json({
    sent: composeProviderPrompt(input),
    sections: providerPromptSections(input),
    attachments: providerAttachmentPlan(input)
  });
}
