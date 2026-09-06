/**
 * Regenerates the checked-in test fixtures under tests/fixtures/.
 *
 * Golden-image tests need real generated art to be meaningful, but the raw
 * sources are ~1.2MB each. This downsamples a few to 192px so the fixtures stay
 * small enough to check in while remaining real model output.
 *
 * Run with: npx tsx scripts/make-fixtures.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCES = [
  "prop_20260902_205306_1.png",
  "prop_20260901_234006_1.png",
  "prop_20260902_000522_1.png"
];

const sourceDir = path.join(process.cwd(), "data", "sources");
const outDir = path.join(process.cwd(), "tests", "fixtures");

async function main(): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });

  for (const [index, name] of SOURCES.entries()) {
    const input = path.join(sourceDir, name);
    if (!fs.existsSync(input)) {
      throw new Error(`fixture source missing: ${input}`);
    }

    const output = path.join(outDir, `sprite-${index + 1}.png`);
    await sharp(input)
      .resize(192, 192, { fit: "inside", kernel: "nearest" })
      .png({ compressionLevel: 9 })
      .toFile(output);

    const { size } = fs.statSync(output);
    console.log(`${path.basename(output)} <- ${name} (${size} bytes)`);
  }
}

void main();
