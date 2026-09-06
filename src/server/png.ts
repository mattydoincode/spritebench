import { PNG } from "pngjs";
import type { RgbaImage, Size } from "@/core/types";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return {
    width: png.width,
    height: png.height,
    data: new Uint8ClampedArray(png.data)
  };
}

export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}

/**
 * Reads dimensions straight out of the IHDR chunk. A 1024x1024 PNG is ~4MB
 * decoded, and nothing that only wants the size should pay for that.
 *
 * Layout: 8-byte signature, then the IHDR chunk whose data begins at byte 16
 * with big-endian width and height.
 */
export function readPngSize(bytes: Uint8Array): Size {
  if (bytes.length < 24) throw new Error("not a PNG: too short");

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG: bad signature");
  }
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("not a PNG: first chunk is not IHDR");
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (width === 0 || height === 0) throw new Error("PNG reports a zero dimension");

  return { width, height };
}
