import { describe, expect, it } from "vitest";
import { ISO_DIAMOND_TEMPLATE_ID } from "@/core/isoMask";
import { decodePng } from "@/server/png";
import { providerAttachmentBytes } from "@/server/providerRequest";
import { DEFAULT_GENERATION } from "@/shared/model";

describe("providerAttachmentBytes", () => {
  it("rebuilds the white-on-black Gemini guide for the iso diamond", async () => {
    const bytes = await providerAttachmentBytes(
      "00000000-0000-0000-0000-000000000000",
      {
        generation: { ...DEFAULT_GENERATION, model: "gemini-3.1-flash-image" },
        inputs: {
          mask: {
            source: { kind: "template", templateId: ISO_DIAMOND_TEMPLATE_ID },
            maskSource: "keepInsideShape",
            dilatePixels: 0,
            fit: "contain"
          }
        },
        sequencePlan: null
      },
      "guide"
    );

    expect(bytes).not.toBeNull();
    const image = decodePng(Buffer.from(bytes!));
    let white = 0;
    let black = 0;
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i] === 255 && image.data[i + 1] === 255 && image.data[i + 2] === 255) white++;
      if (image.data[i] === 0 && image.data[i + 1] === 0 && image.data[i + 2] === 0) black++;
    }

    expect(white).toBeGreaterThan(0);
    expect(black).toBeGreaterThan(0);
    expect(white + black).toBeGreaterThan(image.width * image.height * 0.95);
  });
});
