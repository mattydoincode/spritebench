/**
 * Storage key layout. Every key is a forward-slash path relative to the bucket
 * root, and every key starts with the project it belongs to -- so a tenant is
 * one prefix, and deleting a project is one prefix delete.
 *
 * Keys are derived from ids, never from names. A name-derived key has to be
 * probed for collisions before use (a HEAD request per attempt) and still
 * collides across tenants; an id-derived key is known-free the moment the row
 * exists. Names are display data and live in the Yjs document.
 */

export function projectPrefix(projectId: string): string {
  return `p/${projectId}`;
}

export function sourceKey(projectId: string, assetId: string): string {
  return `${projectPrefix(projectId)}/sources/${assetId}.png`;
}

export function thumbKey(projectId: string, assetId: string): string {
  return `${projectPrefix(projectId)}/thumbs/${assetId}.webp`;
}

export function templateKey(projectId: string, templateId: string): string {
  return `${projectPrefix(projectId)}/templates/${templateId}.png`;
}

export function paletteKey(projectId: string, paletteId: string): string {
  return `${projectPrefix(projectId)}/palettes/${paletteId}`;
}

/**
 * Exports are the one place a name reaches storage, because the point of an
 * export is a file someone can find. `stem` must already be sanitized --
 * `exportStem` in `src/shared/naming.ts` is what produces it.
 */
export function exportKey(projectId: string, folder: string, stem: string): string {
  const dir = folder.length > 0 ? `${folder}/` : "";
  return `${projectPrefix(projectId)}/exports/${dir}${stem}.png`;
}

export function basename(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1);
}
