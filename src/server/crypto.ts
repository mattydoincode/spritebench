import crypto from "node:crypto";
import { encryptionKey } from "./config";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/**
 * Envelope format is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version
 * prefix means the key or algorithm can be rotated without guessing at what a
 * stored value is.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptSecret(envelope: string): string {
  const [version, iv, tag, ciphertext] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("stored secret is not in a recognised format");
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

/** The tail of a key, for showing the user which credential is stored. */
export function maskSecret(plaintext: string): string {
  const tail = plaintext.trim().slice(-4);
  return tail.length > 0 ? `...${tail}` : "";
}
