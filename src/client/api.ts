"use client";

/**
 * The one place a request is made. Everything project-scoped goes through
 * `projectApi`, which is what keeps the project id out of every call site and
 * makes it impossible to forget.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function rejectIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;

  const payload = await response.json().catch(() => null);
  const message =
    payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error: unknown }).error)
      : `request failed (${response.status})`;

  throw new ApiError(response.status, message);
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });

  await rejectIfNotOk(response);
  return (await response.json().catch(() => null)) as T;
}

export function projectUrl(projectId: string, path: string): string {
  return `/api/projects/${projectId}${path}`;
}

export function projectApi<T>(
  projectId: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  return api<T>(projectUrl(projectId, path), init);
}

/** Where the browser and the processing worker fetch image bytes. */
export function sourceUrl(
  projectId: string,
  assetId: string,
  variant: "source" | "thumb"
): string {
  const query = variant === "thumb" ? "?variant=thumb" : "";
  return `/api/projects/${projectId}/assets/${assetId}/source${query}`;
}

/**
 * Workers under Turbopack have a blob: location, so `fetch("/api/...")`
 * throws. Resolve against the page origin before posting across that boundary.
 */
export function absoluteUrl(path: string, origin: string): string {
  return new URL(path, origin).href;
}

export type RequestOwner = { assetId: string } | { jobId: string };

/** A reconstructed image that went out (or will go out) on this provider call. */
export function requestPartUrl(projectId: string, owner: RequestOwner, part: string): string {
  const [kind, id] = "assetId" in owner ? ["assets", owner.assetId] : ["jobs", owner.jobId];
  return `/api/projects/${projectId}/${kind}/${id}/request?part=${encodeURIComponent(part)}`;
}

export function requestOwner(
  assetId?: string | null,
  jobId?: string | null
): RequestOwner | null {
  if (assetId) return { assetId };
  if (jobId) return { jobId };
  return null;
}
