/// <reference lib="webworker" />

import { applyPipeline } from "@/core/pipeline";
import type { ProcessingSettings } from "@/core/settings";
import type { Rgb, RgbaImage } from "@/core/types";

interface ProcessRequest {
  type: "process";
  requestId: number;
  cacheKey: string;
  sourceUrl: string;
  settings: ProcessingSettings;
  palette: Rgb[];
  wantSource: boolean;
}

interface EvictRequest {
  type: "evict";
  cacheKey: string;
}

type Incoming = ProcessRequest | EvictRequest;

const sourceCache = new Map<string, RgbaImage>();

async function loadSource(url: string): Promise<RgbaImage> {
  const cached = sourceCache.get(url);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load source (${response.status})`);

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context available in worker");

  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  const image: RgbaImage = {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data
  };

  if (sourceCache.size > 24) {
    const oldest = sourceCache.keys().next().value;
    if (oldest !== undefined) sourceCache.delete(oldest);
  }
  sourceCache.set(url, image);

  return image;
}

function toBitmap(image: RgbaImage): ImageBitmap {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context available in worker");

  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.transferToImageBitmap();
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;

  if (message.type === "evict") {
    sourceCache.delete(message.cacheKey);
    return;
  }

  try {
    const source = await loadSource(message.sourceUrl);
    const { image, description } = applyPipeline(source, message.settings, message.palette);

    const processed = toBitmap(image);
    const transfer: Transferable[] = [processed];
    let sourceBitmap: ImageBitmap | undefined;

    if (message.wantSource) {
      sourceBitmap = toBitmap(source);
      transfer.push(sourceBitmap);
    }

    self.postMessage(
      {
        type: "result",
        requestId: message.requestId,
        cacheKey: message.cacheKey,
        processed,
        sourceBitmap,
        width: image.width,
        height: image.height,
        sourceWidth: source.width,
        sourceHeight: source.height,
        description
      },
      transfer
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
