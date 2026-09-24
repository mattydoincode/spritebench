import crypto from "node:crypto";

export const API_TOKEN_PREFIX = "sbp_";

export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function mintApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, 11)
  };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;

  return value.trim();
}

export function hashExportBytes(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
