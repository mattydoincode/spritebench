import crypto from "node:crypto";

/** Fixed namespace shared with the Godot addon's `hasher.gd`. */
export const FIELD_SLOT_NAMESPACE = "a3f1c9e2-5b7d-4e8a-9c0f-1d2e3f4a5b6c";

export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Both sides derive a record field's slot id, so a record created on the web
 * can take assignments before Godot has ever seen it.
 */
export function fieldSlotId(recordId: string, fieldKey: string): string {
  return uuidV5(`${recordId.toLowerCase()}:${fieldKey}`, FIELD_SLOT_NAMESPACE);
}
