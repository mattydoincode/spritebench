/**
 * Exercises the S3 driver against a real S3-compatible endpoint.
 *
 * Not part of the test suite because it needs a running server. Point it at
 * MinIO locally, or at the actual R2 bucket once its credentials are set, to
 * confirm the bucket, credentials, and CORS policy work before deploying:
 *
 *   R2_ENDPOINT=http://localhost:9010 R2_ACCESS_KEY_ID=... \
 *   R2_SECRET_ACCESS_KEY=... R2_BUCKET=... tsx scripts/verify-s3.ts
 */
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { R2Storage } from "@/storage/r2";
import { ObjectNotFoundError } from "@/storage/types";

const PREFIX = `verify-${Date.now()}`;

function check(label: string, condition: boolean): void {
  console.log(`${condition ? "ok  " : "FAIL"} ${label}`);
  if (!condition) process.exitCode = 1;
}

async function ensureBucket(): Promise<void> {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  if (!endpoint) return;

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ""
    }
  });

  try {
    await client.send(new CreateBucketCommand({ Bucket: process.env.R2_BUCKET ?? "" }));
    console.log("created the bucket");
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
  }
}

async function main(): Promise<void> {
  await ensureBucket();

  const storage = R2Storage.fromEnv();
  const key = `${PREFIX}/sources/a.png`;
  const payload = Buffer.from("art studio");

  await storage.put(key, payload, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable"
  });
  check("put", true);

  check("get returns the same bytes", Buffer.from(await storage.get(key)).equals(payload));

  const head = await storage.head(key);
  check("head reports the size", head?.size === payload.length);
  check("exists is true", await storage.exists(key));
  check("exists is false for a missing key", !(await storage.exists(`${PREFIX}/nope.png`)));
  check("head is null for a missing key", (await storage.head(`${PREFIX}/nope.png`)) === null);

  const missing = await storage
    .get(`${PREFIX}/nope.png`)
    .then(() => null)
    .catch((error: unknown) => error);
  check("get throws ObjectNotFoundError", missing instanceof ObjectNotFoundError);

  await storage.put(`${PREFIX}/sources/b.png`, payload);
  await storage.put(`${PREFIX}/thumbs/c.webp`, payload);

  const listed = (await storage.list(`${PREFIX}/sources`)).map((entry) => entry.key);
  check("list is scoped to the prefix and sorted", listed.join(",") === `${key},${PREFIX}/sources/b.png`);

  const url = await storage.signedUrl(key, 60);
  check("signedUrl is absolute", url.startsWith("http"));

  const signed = await fetch(url);
  check(`signed URL fetches ${signed.status}`, signed.ok);
  check(
    "cache-control survived the round trip",
    signed.headers.get("cache-control") === "public, max-age=31536000, immutable"
  );
  check("bytes match over HTTP", Buffer.from(await signed.arrayBuffer()).equals(payload));

  await storage.delete(key);
  check("delete removes the object", !(await storage.exists(key)));
  await storage.delete(key);
  check("deleting a missing key is not an error", true);

  await storage.delete(`${PREFIX}/sources/b.png`);
  await storage.delete(`${PREFIX}/thumbs/c.webp`);

  const unsafe = await storage
    .put("../escape.png", payload)
    .then(() => null)
    .catch((error: unknown) => error);
  check("rejects an unsafe key", unsafe instanceof Error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
