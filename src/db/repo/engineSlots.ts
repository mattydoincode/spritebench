import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import {
  deriveSlotStatus,
  type EngineSlotIntent,
  type EngineSlotKind,
  type EngineSlotRecord
} from "@/shared/engineSlot";
import { db } from "../index";
import { engineSlots, type EngineSlotRow } from "../schema";

export interface CatalogSlot {
  id: string;
  kind: EngineSlotKind;
  intent: EngineSlotIntent;
  label: string;
  path: string;
  localHash: string | null;
}

function normalizeIntent(kind: EngineSlotKind, intent?: EngineSlotIntent | null): EngineSlotIntent {
  if (kind === "set_bag") return "textures";
  return intent ?? "texture";
}

function toRecord(row: EngineSlotRow): EngineSlotRecord {
  return {
    id: row.id,
    kind: row.kind,
    intent: row.intent ?? "texture",
    label: row.label,
    godotPath: row.godotPath,
    assignedAssetIds: row.assignedAssetIds ?? [],
    localHash: row.localHash,
    lastPushedHash: row.lastPushedHash,
    remoteHash: row.remoteHash,
    status: deriveSlotStatus(row),
    lastSeenAt: row.lastSeenAt.toISOString(),
    tombstonedAt: row.tombstonedAt?.toISOString() ?? null
  };
}

export async function listEngineSlots(
  projectId: string,
  options: { includeTombstoned?: boolean } = {}
): Promise<EngineSlotRecord[]> {
  const rows = await db()
    .select()
    .from(engineSlots)
    .where(
      options.includeTombstoned
        ? eq(engineSlots.projectId, projectId)
        : and(eq(engineSlots.projectId, projectId), isNull(engineSlots.tombstonedAt))
    )
    .orderBy(asc(engineSlots.label), asc(engineSlots.id));

  return rows.map(toRecord);
}

export async function getEngineSlot(
  projectId: string,
  id: string
): Promise<EngineSlotRow | null> {
  const [row] = await db()
    .select()
    .from(engineSlots)
    .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, id)))
    .limit(1);

  return row ?? null;
}

/**
 * Godot owns the catalog. Rows in the payload are upserted and un-tombstoned.
 * Rows the payload omits are tombstoned, not deleted, so an assignment
 * survives a closed scene.
 */
export async function upsertCatalog(
  projectId: string,
  slots: CatalogSlot[]
): Promise<EngineSlotRecord[]> {
  const now = new Date();
  const ids = slots.map((slot) => slot.id);

  await db().transaction(async (tx) => {
    for (const slot of slots) {
      const [existing] = await tx
        .select({
          remoteHash: engineSlots.remoteHash,
          lastPushedHash: engineSlots.lastPushedHash,
          intent: engineSlots.intent
        })
        .from(engineSlots)
        .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slot.id)))
        .limit(1);

      const intent = normalizeIntent(slot.kind, slot.intent);
      const intentChanged = Boolean(existing && (existing.intent ?? "texture") !== intent);
      const synced = intentChanged
        ? null
        : slot.localHash && existing?.remoteHash && slot.localHash === existing.remoteHash
          ? slot.localHash
          : (existing?.lastPushedHash ?? null);

      await tx
        .insert(engineSlots)
        .values({
          id: slot.id,
          projectId,
          kind: slot.kind,
          intent,
          label: slot.label,
          godotPath: slot.path,
          localHash: slot.localHash,
          lastPushedHash: synced,
          lastSeenAt: now,
          tombstonedAt: null,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: engineSlots.id,
          set: {
            kind: slot.kind,
            intent,
            label: slot.label,
            godotPath: slot.path,
            localHash: slot.localHash,
            lastPushedHash: synced,
            lastSeenAt: now,
            tombstonedAt: null,
            updatedAt: now
          }
        });
    }

    if (ids.length === 0) {
      await tx
        .update(engineSlots)
        .set({ tombstonedAt: now, updatedAt: now })
        .where(and(eq(engineSlots.projectId, projectId), isNull(engineSlots.tombstonedAt)));
      return;
    }

    await tx
      .update(engineSlots)
      .set({ tombstonedAt: now, updatedAt: now })
      .where(
        and(
          eq(engineSlots.projectId, projectId),
          isNull(engineSlots.tombstonedAt),
          notInArray(engineSlots.id, ids)
        )
      );
  });

  return listEngineSlots(projectId);
}

export async function assignEngineSlot(
  projectId: string,
  slotId: string,
  assetIds: string[],
  remoteHash: string | null
): Promise<EngineSlotRecord | null> {
  const [row] = await db()
    .update(engineSlots)
    .set({
      assignedAssetIds: assetIds,
      remoteHash,
      tombstonedAt: null,
      updatedAt: new Date()
    })
    .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slotId)))
    .returning();

  return row ? toRecord(row) : null;
}

export async function setSlotRemoteHash(
  projectId: string,
  slotId: string,
  remoteHash: string
): Promise<void> {
  await db()
    .update(engineSlots)
    .set({ remoteHash, updatedAt: new Date() })
    .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slotId)));
}
