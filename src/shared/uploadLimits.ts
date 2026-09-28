/** Files per signing request; the client sends larger drops in chunks. */
export const MAX_UPLOAD_FILES = 20;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Decoded size is what costs memory, not file size: a 25 MB PNG can decode to
 * hundreds of MB. 40 megapixels (about 6300 square) is ~160 MB as RGBA, which
 * one ingest at a time on a 1 GB worker can afford alongside generations.
 */
export const MAX_UPLOAD_PIXELS = 40_000_000;
