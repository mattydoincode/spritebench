/**
 * Exercises the asset lifecycle against a scratch database and data directory:
 * migrations from empty, asset rows, soft delete, and metering.
 *
 * Point DATABASE_URL at a throwaway database -- it writes and deletes rows:
 *
 *   DATABASE_URL=postgres://.../spritebench_verify \
 *   SPRITEBENCH_DATA_DIR=/tmp/art-verify tsx scripts/verify-lifecycle.ts
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "@/db";
import { countAssets, insertAsset, softDeleteAsset } from "@/db/repo/assets";
import { createProject } from "@/db/repo/projects";
import { users } from "@/db/schema";
import { recordUsage, usageSince } from "@/db/repo/usage";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { DEFAULT_GENERATION } from "@/shared/model";
import { sourceKey, thumbKey } from "@/storage/keys";
import { storage } from "@/storage";

const PNG = Buffer.from("fake png bytes");
const WEBP = Buffer.from("fake webp");

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures++;
}

async function seedAsset(
  projectId: string,
  userId: string,
  label: string,
  expiresAt: Date | null
): Promise<{ id: string; source: string; thumb: string }> {
  const id = crypto.randomUUID();
  const source = sourceKey(projectId, id);
  const thumb = thumbKey(projectId, id);

  await storage().put(source, PNG, { contentType: "image/png" });
  await storage().put(thumb, WEBP, { contentType: "image/webp" });

  const asset = await insertAsset({
    id,
    projectId,
    createdByUserId: userId,
    sourceKey: source,
    thumbKey: thumb,
    sourceWidth: 1024,
    sourceHeight: 1024,
    byteSize: PNG.length,
    prompt: { prefix: "", body: label, suffix: "" },
    composedPrompt: label,
    generation: DEFAULT_GENERATION,
    processing: DEFAULT_PROCESSING,
    rerunOf: null,
    jobId: null,
    inputs: null,
    sequencePlan: null,
    usage: null,
    elapsedSeconds: null,
    expiresAt
  });

  return { id: asset.id, source, thumb };
}

async function main(): Promise<void> {
  console.log("applying migrations to an empty database");
  await migrate(db(), { migrationsFolder: "./drizzle" });
  check("migrations run from empty", true);

  const [user] = await db()
    .insert(users)
    .values({ email: `verify+${Date.now()}@example.com`, name: "Verify" })
    .returning();

  const userId = user.id;
  const project = await createProject(userId, "verify");
  const projectId = project.id;

  check("scratch user and project exist", Boolean(userId && projectId));
  check("starts with no assets", (await countAssets(projectId)) === 0);

  const fresh = await seedAsset(projectId, userId, "fresh", null);
  const kept = await seedAsset(projectId, userId, "kept", null);
  check("seeded assets are counted", (await countAssets(projectId)) === 2);

  // --- soft delete ------------------------------------------------------
  await softDeleteAsset(projectId, fresh.id);
  check("a deleted asset is gone", (await countAssets(projectId)) === 1);

  // --- metering ---------------------------------------------------------
  await recordUsage({
    projectId,
    userId,
    jobId: null,
    provider: "openai",
    model: "gpt-image-2",
    operation: "generate",
    images: 2,
    totalTokens: 300,
    inputTokens: 100,
    outputTokens: 200,
    elapsedSeconds: 4.5
  });
  await recordUsage({
    projectId,
    userId,
    jobId: null,
    provider: "openai",
    model: "gpt-image-2",
    operation: "edit",
    images: 1,
    totalTokens: 150,
    inputTokens: 50,
    outputTokens: 100,
    elapsedSeconds: 2
  });

  const totals = await usageSince(projectId, new Date(Date.now() - 3600_000));
  check("usage rows are counted", totals.calls === 2, `${totals.calls} calls`);
  check("usage images are summed", totals.images === 3, `${totals.images} images`);
  check("usage tokens are summed", totals.totalTokens === 450, `${totals.totalTokens} tokens`);

  // --- cleanup ----------------------------------------------------------
  for (const key of [fresh.source, fresh.thumb, kept.source, kept.thumb]) {
    await storage().delete(key);
  }

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
