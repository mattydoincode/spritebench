import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectNotFoundError,
  asBytes,
  assertSafeKey,
  type Bytes,
  type PutOptions,
  type Storage,
  type StoredObject
} from "./types";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=r2`);
  return value;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;

  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * S3-compatible object storage. Written against the S3 API rather than
 * anything Cloudflare-specific, so MinIO and Backblaze work unchanged.
 */
export class R2Storage implements Storage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    /** Optional public base URL (a custom domain in front of the bucket). */
    private readonly publicBase: string | null
  ) {}

  static fromEnv(): R2Storage {
    // An explicit endpoint covers MinIO and other S3-compatible stores, which
    // is also how this driver gets tested without a Cloudflare account.
    const override = process.env.R2_ENDPOINT?.trim();

    const client = new S3Client({
      region: "auto",
      endpoint: override || `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      // Virtual-hosted style needs DNS per bucket, which a local endpoint
      // does not have. R2 accepts either.
      forcePathStyle: Boolean(override),
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID"),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY")
      }
    });

    const publicBase = process.env.R2_PUBLIC_BASE?.trim().replace(/\/$/, "") ?? "";

    return new R2Storage(client, required("R2_BUCKET"), publicBase.length > 0 ? publicBase : null);
  }

  async put(key: string, bytes: Uint8Array, options?: PutOptions): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeKey(key),
        Body: bytes,
        ContentType: options?.contentType,
        CacheControl: options?.cacheControl
      })
    );
  }

  async get(key: string): Promise<Bytes> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) })
      );

      if (!response.Body) throw new ObjectNotFoundError(key);
      return asBytes(await response.Body.transformToByteArray());
    } catch (error) {
      if (isMissing(error)) throw new ObjectNotFoundError(key);
      throw error;
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) })
      );

      return {
        key,
        size: response.ContentLength ?? 0,
        modifiedAt: response.LastModified ?? new Date(0)
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) })
    );
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let token: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token
        })
      );

      for (const entry of response.Contents ?? []) {
        if (!entry.Key) continue;
        out.push({
          key: entry.Key,
          size: entry.Size ?? 0,
          modifiedAt: entry.LastModified ?? new Date(0)
        });
      }

      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);

    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);

    // A custom domain in front of the bucket serves the object directly, which
    // avoids a signature round-trip and lets Cloudflare cache it.
    if (this.publicBase) {
      return `${this.publicBase}/${key.split("/").map(encodeURIComponent).join("/")}`;
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds }
    );
  }
}
