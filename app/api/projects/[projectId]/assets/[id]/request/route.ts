import { NextResponse } from "next/server";
import { getAsset } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { providerAttachmentBytes } from "@/server/providerRequest";
import { withValidation } from "@/server/validation";
import {
  composeProviderPrompt,
  providerAttachmentPlan,
  providerPromptSections,
  type AttachmentRole
} from "@/shared/providerPrompt";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

const ATTACHMENT_IDS = new Set<AttachmentRole>(["guide", "reference", "base", "mask"]);

/**
 * What this asset's generation actually sent: prompt parts plus any
 * reference / mask / layout-guide images, reconstructed from the stored
   * inputs or sheet plan.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const { id } = await params;
    const asset = await getAsset(projectId, id);
    if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

    const input = {
      prompt: asset.prompt,
      composedPrompt: asset.composedPrompt,
      generation: asset.generation,
      inputs: asset.inputs,
      sequencePlan: asset.sequencePlan
    };

    const part = new URL(request.url).searchParams.get("part");
    if (part) {
      if (!ATTACHMENT_IDS.has(part as AttachmentRole)) {
        return NextResponse.json({ error: "unknown request part" }, { status: 400 });
      }

      const bytes = await providerAttachmentBytes(projectId, asset, part as AttachmentRole);
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
  });
}
