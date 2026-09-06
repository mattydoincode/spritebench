import { and, asc, eq, isNull } from "drizzle-orm";
import type { Composition } from "@/shared/model";
import { db } from "../index";
import { compositions, type CompositionRow } from "../schema";

/** Raised when a client writes against a version that has already moved on. */
export class CompositionConflictError extends Error {
  constructor(
    readonly current: Composition,
    readonly currentVersion: number
  ) {
    super("composition changed elsewhere");
    this.name = "CompositionConflictError";
  }
}

function normalize(doc: Composition, row: CompositionRow): Composition {
  return {
    ...doc,
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
    items: doc.items ?? [],
    groups: (doc.groups ?? []).map((group) => ({
      ...group,
      randomRotate: group.randomRotate ?? false,
      background: group.background ?? ""
    })),
    palettePool: doc.palettePool ?? [],
    palette: doc.palette ?? "",
    paletteDither: doc.paletteDither ?? "none",
    paletteDitherStrength: doc.paletteDitherStrength ?? 1,
    version: row.version
  };
}

export function toComposition(row: CompositionRow): Composition {
  return normalize(row.doc, row);
}

export async function listCompositions(userId: string): Promise<Composition[]> {
  const rows = await db()
    .select()
    .from(compositions)
    .where(and(eq(compositions.userId, userId), isNull(compositions.deletedAt)))
    .orderBy(asc(compositions.createdAt));

  return rows.map(toComposition);
}

export async function getComposition(userId: string, id: string): Promise<Composition | null> {
  const [row] = await db()
    .select()
    .from(compositions)
    .where(
      and(
        eq(compositions.id, id),
        eq(compositions.userId, userId),
        isNull(compositions.deletedAt)
      )
    )
    .limit(1);

  return row ? toComposition(row) : null;
}

/**
 * Insert-or-update with optimistic concurrency. `expectedVersion` is the
 * version the client last saw; a mismatch means another tab or device wrote
 * first, and we refuse rather than silently clobbering.
 */
export async function saveComposition(
  userId: string,
  doc: Composition,
  expectedVersion: number | null
): Promise<Composition> {
  const [existing] = await db()
    .select()
    .from(compositions)
    .where(and(eq(compositions.id, doc.id), eq(compositions.userId, userId)))
    .limit(1);

  if (!existing) {
    const [created] = await db()
      .insert(compositions)
      .values({
        id: doc.id,
        userId,
        name: doc.name,
        doc,
        version: 1
      })
      .returning();

    return toComposition(created);
  }

  if (expectedVersion !== null && existing.version !== expectedVersion) {
    throw new CompositionConflictError(toComposition(existing), existing.version);
  }

  const [updated] = await db()
    .update(compositions)
    .set({
      name: doc.name,
      doc,
      version: existing.version + 1,
      updatedAt: new Date(),
      deletedAt: null
    })
    .where(and(eq(compositions.id, doc.id), eq(compositions.version, existing.version)))
    .returning();

  if (!updated) {
    // Lost a race between the read and the write.
    const current = await getComposition(userId, doc.id);
    throw new CompositionConflictError(current ?? doc, existing.version + 1);
  }

  return toComposition(updated);
}

export async function deleteComposition(userId: string, id: string): Promise<void> {
  await db()
    .update(compositions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(compositions.id, id), eq(compositions.userId, userId)));
}
