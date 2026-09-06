/**
 * Copies every object from the local storage driver into the S3 driver.
 *
 * Used to move a locally verified library into R2 without re-running the
 * legacy import, and to rehearse the R2 path before deploying:
 *
 *   SPRITEBENCH_DATA_DIR=./data-pg R2_ENDPOINT=... R2_BUCKET=... \
 *   tsx scripts/mirror-storage.ts
 */
import { EXPORTS, PALETTES, SOURCES, TEMPLATES, THUMBS } from "@/storage/keys";
import { LocalFsStorage } from "@/storage/local";
import { R2Storage } from "@/storage/r2";
import { dataRoot } from "@/storage";

const PREFIXES = [SOURCES, THUMBS, TEMPLATES, PALETTES, EXPORTS];

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  json: "application/json"
};

function contentType(key: string): string {
  return CONTENT_TYPES[key.slice(key.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}

async function main(): Promise<void> {
  const from = new LocalFsStorage(dataRoot());
  const to = R2Storage.fromEnv();

  let copied = 0;
  let bytes = 0;

  for (const prefix of PREFIXES) {
    for (const object of await from.list(prefix)) {
      const payload = await from.get(object.key);

      await to.put(object.key, payload, {
        contentType: contentType(object.key),
        cacheControl: "public, max-age=31536000, immutable"
      });

      copied++;
      bytes += payload.length;
    }
  }

  console.log(`mirrored ${copied} object(s), ${(bytes / 1_048_576).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
