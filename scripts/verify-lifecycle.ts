/**
 * Exercises the asset lifecycle against a scratch database and data directory:
 * migrations from empty, quota accounting, source roll-off, and metering.
 *
 * Point DATABASE_URL at a throwaway database -- it writes and deletes rows:
 *
 *   DATABASE_URL=postgres://.../art_studio_verify \
 *   ART_STUDIO_DATA_DIR=/tmp/art-verify tsx scripts/verify-lifecycle.ts
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "@/db";
import {
  clearSource,
  countAssets,
  insertAsset,
  listExpiredSources,
  softDeleteAsset
} from "@/db/repo/assets";
import { insertJob } from "@/db/repo/jobs";
import { currentUserId } from "@/db/repo/users";
import { recordUsage, usageSince } from "@/db/repo/usage";
import { assertCapacity, QuotaExceededError } from "@/server/generation";
import { freeAssetLimit, maxImagesPerRequest } from "@/server/config";
import { DEFAULT_PROCESSING } from "@/core/settings";
import { DEFAULT_GENERATION } from "@/shared/model";
import { sourceKey, thumbKey } from "@/storage/keys";
import { storage } from "@/storage";
import { pruneExpiredSources } from "@/worker/prune";

const PNG = Buffer.from("fake png bytes");
const WEBP = Buffer.from("fake webp");

let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!condition) failures++;
}

async function seedAsset(
  userId: string,
  name: string,
  expiresAt: Date | null
): Promise<{ id: string; source: string; thumb: string }> {
  const source = sourceKey(`${name}.png`);
  const thumb = thumbKey(name);

  await storage().put(source, PNG, { contentType: "image/png" });
  await storage().put(thumb, WEBP, { contentType: "image/webp" });

  const asset = await insertAsset({
    userId,
    name,
    folder: "verify",
    tags: [],
    sourceKey: source,
    thumbKey: thumb,
    sourceWidth: 1024,
    sourceHeight: 1024,
    byteSize: PNG.length,
    prompt: { prefix: "", body: name, suffix: "" },
    composedPrompt: name,
    generation: DEFAULT_GENERATION,
    processing: DEFAULT_PROCESSING,
    processingDescription: "",
    rerunOf: null,
    jobId: null,
    template: null,
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

  const userId = await currentUserId();
  check("seeded user exists", Boolean(userId));
  check("starts with no assets", (await countAssets(userId)) === 0);

  // --- roll-off ---------------------------------------------------------
  const yesterday = new Date(Date.now() - 86_400_000);
  const nextMonth = new Date(Date.now() + 30 * 86_400_000);

  const expired = await seedAsset(userId, "expired", yesterday);
  const fresh = await seedAsset(userId, "fresh", nextMonth);
  const forever = await seedAsset(userId, "no-expiry", null);

  const due = await listExpiredSources(500);
  check("only the past-due asset is listed", due.length === 1 && due[0].id === expired.id, `${due.length} due`);

  const pruned = await pruneExpiredSources();
  check("prune reports one roll-off", pruned === 1, `pruned ${pruned}`);
  check("expired source object is gone", !(await storage().exists(expired.source)));
  check("expired thumbnail is kept", await storage().exists(expired.thumb));
  check("fresh source is untouched", await storage().exists(fresh.source));
  check("source with no expiry is untouched", await storage().exists(forever.source));

  check("rolled-off row survives", (await countAssets(userId)) === 3);

  const rolled = await listExpiredSources(500);
  check("a second run finds nothing", rolled.length === 0);
  check("prune is idempotent", (await pruneExpiredSources()) === 0);

  // --- quota ------------------------------------------------------------
  // The fan-out cap is checked first and is normally well below the quota, so
  // this needs a small FREE_ASSET_LIMIT to reach the quota branch at all.
  const limit = freeAssetLimit();
  const headroom = limit - 3;

  if (headroom > maxImagesPerRequest()) {
    throw new Error(
      `run with FREE_ASSET_LIMIT below ${maxImagesPerRequest() + 3} so the quota is reached before the fan-out cap`
    );
  }

  await assertCapacity(userId, headroom);
  check("quota allows exactly the remaining headroom", true, `${headroom} of ${limit}`);

  const over = await assertCapacity(userId, headroom + 1)
    .then(() => null)
    .catch((error: unknown) => error);
  check("quota refuses one image too many", over instanceof QuotaExceededError);

  // A rolled-off asset still counts: the row and thumbnail remain.
  check("rolled-off assets still count against the quota", (await countAssets(userId)) === 3);

  await insertJob({
    userId,
    label: "pending",
    batchId: null,
    batchIndex: 1,
    batchSize: 1,
    prompt: { prefix: "", body: "pending", suffix: "" },
    composedPrompt: "pending",
    generation: { ...DEFAULT_GENERATION, imageCount: 5 },
    processing: DEFAULT_PROCESSING,
    folder: "verify",
    template: null,
    rerunOf: null
  });

  const withPending = await assertCapacity(userId, headroom)
    .then(() => null)
    .catch((error: unknown) => error);
  check(
    "a queued job's images count against the quota",
    withPending instanceof QuotaExceededError,
    withPending instanceof Error ? withPending.message : ""
  );

  // --- soft delete ------------------------------------------------------
  await softDeleteAsset(userId, fresh.id);
  check("a deleted asset frees quota", (await countAssets(userId)) === 2);

  // --- metering ---------------------------------------------------------
  await recordUsage({
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

  const totals = await usageSince(userId, new Date(Date.now() - 3600_000));
  check("usage rows are counted", totals.calls === 2, `${totals.calls} calls`);
  check("usage images are summed", totals.images === 3, `${totals.images} images`);
  check("usage tokens are summed", totals.totalTokens === 450, `${totals.totalTokens} tokens`);

  // --- cleanup ----------------------------------------------------------
  await clearSource(fresh.id);
  for (const key of [fresh.source, fresh.thumb, forever.source, forever.thumb, expired.thumb]) {
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
