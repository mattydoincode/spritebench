import { NextResponse } from "next/server";
import { withDefaults } from "@/core/settings";
import { insertAsset, listSourceKeys } from "@/db/repo/assets";
import { currentUserId, readSettings } from "@/db/repo/users";
import { readPngSize } from "@/server/png";
import { SOURCES, basename } from "@/storage/keys";
import { storage } from "@/storage";

export const dynamic = "force-dynamic";

/**
 * Adopts source objects that exist in storage but have no asset row -- the
 * result of a crashed job, or of copying files in by hand.
 *
 * The old filesystem-scanning behaviour (external import directories, legacy
 * JSON sidecars, approved-file discovery) now lives in scripts/import-legacy.ts,
 * which runs once against a pre-migration data directory.
 */
export async function POST() {
  const userId = await currentUserId();
  const settings = await readSettings(userId);

  const known = new Set(await listSourceKeys(userId));
  const objects = await storage().list(`${SOURCES}/`);

  let imported = 0;

  for (const object of objects) {
    if (!object.key.toLowerCase().endsWith(".png") || known.has(object.key)) continue;

    let size;
    try {
      size = readPngSize(await storage().get(object.key));
    } catch {
      continue;
    }

    await insertAsset({
      userId,
      name: basename(object.key).slice(0, -".png".length),
      folder: "imported",
      tags: ["imported"],
      sourceKey: object.key,
      sourceWidth: size.width,
      sourceHeight: size.height,
      byteSize: object.size,
      prompt: { prefix: "", body: "", suffix: "" },
      composedPrompt: "",
      generation: { ...settings.generation, size },
      processing: withDefaults(settings.processing),
      createdAt: object.modifiedAt
    });

    known.add(object.key);
    imported++;
  }

  return NextResponse.json({ imported, total: known.size });
}
