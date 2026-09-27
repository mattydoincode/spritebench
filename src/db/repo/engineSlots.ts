import crypto from "node:crypto";
import { and, asc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import {
  deriveSlotStatus,
  laneRemoteHash,
  servedLane,
  type EngineLane,
  type EngineSlotIntent,
  type EngineSlotKind,
  type EngineSlotRecord
} from "@/shared/engineSlot";
import { db } from "../index";
import { engineSlots, projects, type EngineSlotRow } from "../schema";
import { syncCatalogCollections, type CatalogCollection } from "./engineCollections";

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

/** Which lane the game pulls, as the plugin last reported. */
export async function gameLane(projectId: string): Promise<EngineLane> {
  const [row] = await db()
    .select({ lane: projects.engineLane })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row?.lane === "prototype" ? "prototype" : "final";
}

export async function setGameLane(projectId: string, lane: EngineLane): Promise<void> {
  await db().update(projects).set({ engineLane: lane }).where(eq(projects.id, projectId));
}

function toRecord(row: EngineSlotRow, game: EngineLane): EngineSlotRecord {
  const finalAssetIds = row.finalAssetIds ?? [];
  const lane = servedLane({ finalAssetIds }, game);
  const remoteHash = laneRemoteHash(row, lane);

  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    intent: row.intent ?? "texture",
    label: row.label,
    godotPath: row.godotPath,
    assignedAssetIds: row.assignedAssetIds ?? [],
    finalAssetIds,
    localHash: row.localHash,
    lastPushedHash: row.lastPushedHash,
    remoteHash: row.remoteHash,
    finalRemoteHash: row.finalRemoteHash,
    lane,
    // Measured against what Godot is actually served for this slot.
    status: deriveSlotStatus({ ...row, remoteHash }),
    lastSeenAt: row.lastSeenAt.toISOString(),
    tombstonedAt: row.tombstonedAt?.toISOString() ?? null,
    recordId: row.recordId ?? null,
    fieldKey: row.fieldKey ?? null
  };
}

export async function listEngineSlots(
  projectId: string,
  options: { includeTombstoned?: boolean } = {}
): Promise<EngineSlotRecord[]> {
  const [rows, game] = await Promise.all([
    db()
      .select()
      .from(engineSlots)
      .where(
        options.includeTombstoned
          ? eq(engineSlots.projectId, projectId)
          : and(eq(engineSlots.projectId, projectId), isNull(engineSlots.tombstonedAt))
      )
      .orderBy(asc(engineSlots.label), asc(engineSlots.id)),
    gameLane(projectId)
  ]);

  return rows.map((row) => toRecord(row, game));
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
 *
 * Record field slots are left to the collection sync instead: a record
 * created on the web has slots before Godot has ever listed them. An older
 * addon that sends no `collections` leaves collections untouched.
 */
export async function upsertCatalog(
  projectId: string,
  slots: CatalogSlot[],
  collections?: CatalogCollection[]
): Promise<EngineSlotRecord[]> {
  const now = new Date();
  const ids = slots.map((slot) => slot.id);
  const game = await gameLane(projectId);

  await db().transaction(async (tx) => {
    for (const slot of slots) {
      const [existing] = await tx
        .select({
          remoteHash: engineSlots.remoteHash,
          finalRemoteHash: engineSlots.finalRemoteHash,
          finalAssetIds: engineSlots.finalAssetIds,
          lastPushedHash: engineSlots.lastPushedHash,
          intent: engineSlots.intent
        })
        .from(engineSlots)
        .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slot.id)))
        .limit(1);

      const intent = normalizeIntent(slot.kind, slot.intent);
      const intentChanged = Boolean(existing && (existing.intent ?? "texture") !== intent);
      // Compared with the lane Godot is served, not always the prototype.
      const served = existing
        ? laneRemoteHash(existing, servedLane({ finalAssetIds: existing.finalAssetIds ?? [] }, game))
        : null;
      const synced = intentChanged
        ? null
        : slot.localHash && served && slot.localHash === served
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
            // Removed in SpriteBench: Godot listing it again does not bring it back.
            tombstonedAt: sql`case when ${engineSlots.removedOnWeb} then ${engineSlots.tombstonedAt} else null end`,
            updatedAt: now
          }
        });
    }

    await tx
      .update(engineSlots)
      .set({ tombstonedAt: now, updatedAt: now })
      .where(
        and(
          eq(engineSlots.projectId, projectId),
          isNull(engineSlots.tombstonedAt),
          ne(engineSlots.kind, "record_field"),
          // SpriteBench's own assets are not Godot's to remove.
          eq(engineSlots.origin, "godot"),
          ids.length > 0 ? notInArray(engineSlots.id, ids) : undefined
        )
      );

    if (collections) {
      await syncCatalogCollections(tx, projectId, collections, now);
    }
  });

  return listEngineSlots(projectId);
}

export async function assignEngineSlot(
  projectId: string,
  slotId: string,
  assetIds: string[],
  remoteHash: string | null,
  lane: EngineLane = "prototype"
): Promise<EngineSlotRecord | null> {
  const [row] = await db()
    .update(engineSlots)
    .set({
      ...(lane === "final"
        ? { finalAssetIds: assetIds, finalRemoteHash: remoteHash }
        : { assignedAssetIds: assetIds, remoteHash }),
      tombstonedAt: null,
      updatedAt: new Date()
    })
    .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slotId)))
    .returning();

  return row ? toRecord(row, await gameLane(projectId)) : null;
}

export async function setSlotRemoteHash(
  projectId: string,
  slotId: string,
  remoteHash: string,
  lane: EngineLane = "prototype"
): Promise<void> {
  await db()
    .update(engineSlots)
    .set({
      ...(lane === "final" ? { finalRemoteHash: remoteHash } : { remoteHash }),
      updatedAt: new Date()
    })
    .where(and(eq(engineSlots.projectId, projectId), eq(engineSlots.id, slotId)));
}

export class GameAssetError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GameAssetError";
  }
}

/**
 * A standalone asset (one image) or list (ordered images) made in SpriteBench.
 * The plugin writes it into the project's `assets.tres` set under `key`.
 */
export async function createWebAsset(
  projectId: string,
  key: string,
  list: boolean
): Promise<string> {
  const [clash] = await db()
    .select({ id: engineSlots.id })
    .from(engineSlots)
    .where(
      and(
        eq(engineSlots.projectId, projectId),
        eq(engineSlots.origin, "web"),
        eq(engineSlots.label, key),
        isNull(engineSlots.tombstonedAt)
      )
    )
    .limit(1);
  if (clash) throw new GameAssetError(`there is already an asset called ${key}`, 409);

  const id = crypto.randomUUID();
  await db().insert(engineSlots).values({
    id,
    projectId,
    origin: "web",
    kind: list ? "set_bag" : "set_item",
    intent: list ? "textures" : "texture",
    label: key,
    godotPath: ""
  });
  return id;
}

/**
 * Removes a game asset from SpriteBench. One made here goes from Godot on the
 * next sync; one Godot made is marked removed so its listing never brings it
 * back, and Godot keeps whatever art it last pulled.
 */
export async function removeGameAsset(projectId: string, slotId: string): Promise<void> {
  const now = new Date();
  const [row] = await db()
    .update(engineSlots)
    .set({
      tombstonedAt: now,
      updatedAt: now,
      removedOnWeb: sql`${engineSlots.origin} = 'godot'`
    })
    .where(
      and(
        eq(engineSlots.projectId, projectId),
        eq(engineSlots.id, slotId),
        ne(engineSlots.kind, "record_field")
      )
    )
    .returning({ id: engineSlots.id });
  if (!row) throw new GameAssetError("that game asset does not exist", 404);
}

/** Renames an asset or list made in SpriteBench; Godot's follow their node or item names. */
export async function renameWebAsset(projectId: string, slotId: string, key: string): Promise<void> {
  const [clash] = await db()
    .select({ id: engineSlots.id })
    .from(engineSlots)
    .where(
      and(
        eq(engineSlots.projectId, projectId),
        eq(engineSlots.origin, "web"),
        eq(engineSlots.label, key),
        isNull(engineSlots.tombstonedAt),
        ne(engineSlots.id, slotId)
      )
    )
    .limit(1);
  if (clash) throw new GameAssetError(`there is already an asset called ${key}`, 409);

  const [row] = await db()
    .update(engineSlots)
    .set({ label: key, updatedAt: new Date() })
    .where(
      and(
        eq(engineSlots.projectId, projectId),
        eq(engineSlots.id, slotId),
        eq(engineSlots.origin, "web")
      )
    )
    .returning({ id: engineSlots.id });
  if (!row) throw new GameAssetError("rename this one in Godot", 409);
}
