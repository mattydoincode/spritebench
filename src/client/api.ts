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

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `request failed (${response.status})`;

    throw new ApiError(response.status, message);
  }

  return payload as T;
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

/** A reconstructed image that went out on this asset's provider call. */
export function requestPartUrl(
  projectId: string,
  assetId: string,
  part: string
): string {
  return `/api/projects/${projectId}/assets/${assetId}/request?part=${encodeURIComponent(part)}`;
}
