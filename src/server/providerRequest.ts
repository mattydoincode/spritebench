import { flattenEditGuide } from "@/core/guide";
import { findModel } from "@/providers/models";
import type { GenerationParams, JobInputs, SequencePlan } from "@/shared/model";
import type { AttachmentRole } from "@/shared/providerPrompt";
import { asBytes, type Bytes } from "@/storage/types";
import { decodePng, encodePng } from "./png";
import { editInputsForJob } from "./template";

export async function providerAttachmentBytes(
  projectId: string,
  job: {
    inputs?: JobInputs | null;
    sequencePlan?: SequencePlan | null;
    generation: GenerationParams;
  },
  part: AttachmentRole
): Promise<Bytes | null> {
  const inputs = await editInputsForJob(projectId, job);
  if (!inputs) return null;

  const gemini = findModel(job.generation.model)?.provider === "gemini";

  if (gemini) {
    if (inputs.plate) {
      if (part === "reference") return inputs.base;
      if (part === "guide") return inputs.plate;
      return null;
    }
    if (part === "guide" && inputs.mask) {
      return asBytes(
        encodePng(flattenEditGuide(decodePng(Buffer.from(inputs.base)), decodePng(Buffer.from(inputs.mask))))
      );
    }
    if (part === "reference" && !inputs.mask) return inputs.base;
    return null;
  }

  if (part === "base") return inputs.base;
  if (part === "mask") return inputs.mask;
  if (part === "guide") return inputs.plate ?? null;
  return null;
}
