"use client";

import * as Y from "yjs";
import { LOCAL_ORIGIN, REMOTE_ORIGIN, applyRemote, assetEditsMap, scenesMap } from "@/shared/doc";
import { projectUrl } from "@/client/api";

/**
 * Keeps one project's Yjs document in step with the server over plain HTTP.
 *
 * Polling works here for a reason specific to CRDTs: updates are commutative
 * and idempotent, so a client that hears about a change a second late reaches
 * exactly the same document as one on a websocket. Nothing has to arrive in
 * order, nothing has to arrive once, and a client that was offline for an
 * hour catches up by asking for everything after the sequence it remembers.
 *
 * Replacing this file with a websocket -- or a Cloudflare Durable Object --
 * changes latency and nothing else. The document, the merge behaviour and
 * undo do not know how bytes arrive.
 */

/** Idle cadence. A no-op poll is a 204 with one header. */
const POLL_IDLE_MS = 2500;

/** Cadence just after a local edit, while a collaborator is likely replying. */
const POLL_ACTIVE_MS = 800;

/** How long after an edit to keep polling at the faster rate. */
const ACTIVE_WINDOW_MS = 15_000;

/**
 * How long local updates accumulate before being sent. Long enough to fold a
 * slider scrub into one request, short enough that a collaborator sees a drag
 * land without waiting.
 */
const FLUSH_MS = 250;

export interface DocSyncOptions {
  projectId: string;
  /** Whether this member may write. Viewers sync but never POST. */
  canEdit: boolean;
  onChange: () => void;
  onError: (message: string) => void;
}

export class DocSync {
  readonly doc = new Y.Doc();
  readonly undoManager: Y.UndoManager;

  private seq = 0;
  private outbound: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLocalEditAt = 0;
  private stopped = false;
  private loaded = false;

  constructor(private readonly options: DocSyncOptions) {
    // Undo tracks only local edits. `Y.UndoManager` applies its own changes
    // with itself as the origin, which is why the outbound filter below keys
    // off "not remote" rather than "is local" -- an undo has to be sent like
    // any other edit.
    this.undoManager = new Y.UndoManager(
      [scenesMap(this.doc), assetEditsMap(this.doc)],
      {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
        // One transaction, one undo step. The default merges anything within
        // 500ms, and since a gesture already commits as a single transaction
        // that would only glue two separate gestures together -- drag one
        // sprite, quickly drag another, and Ctrl+Z takes back both.
        captureTimeout: 0
      }
    );

    this.doc.on("update", this.onDocUpdate);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    this.options.onChange();

    if (origin === REMOTE_ORIGIN) return;
    if (!this.options.canEdit) return;

    this.lastLocalEditAt = Date.now();
    this.outbound.push(update);

    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_MS);
  };

  /** True once the initial document has arrived. */
  get ready(): boolean {
    return this.loaded;
  }

  async start(): Promise<void> {
    await this.pull(null);
    this.loaded = true;
    this.options.onChange();
    this.schedulePoll();
  }

  stop(): void {
    this.stopped = true;
    this.doc.off("update", this.onDocUpdate);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.undoManager.destroy();
    this.doc.destroy();
  }

  private schedulePoll(): void {
    if (this.stopped) return;

    const active = Date.now() - this.lastLocalEditAt < ACTIVE_WINDOW_MS;

    this.pollTimer = setTimeout(
      () => {
        void this.pull(this.seq).finally(() => this.schedulePoll());
      },
      active ? POLL_ACTIVE_MS : POLL_IDLE_MS
    );
  }

  /**
   * Fetches either the whole document (`since === null`) or the tail after a
   * sequence. Both arrive as raw Yjs bytes and are applied the same way,
   * which is why a cold load and a catch-up need no separate code path.
   */
  private async pull(since: number | null): Promise<void> {
    const query = since === null ? "" : `?since=${since}`;

    let response: Response;
    try {
      response = await fetch(projectUrl(this.options.projectId, `/doc${query}`), {
        cache: "no-store"
      });
    } catch {
      // A dropped poll is not an error worth showing: the next one recovers,
      // and the document on screen is still perfectly usable offline.
      return;
    }

    if (response.status === 204) {
      this.advanceSeq(response);
      return;
    }

    if (!response.ok) {
      // A cold load that fails leaves an empty canvas, which does need saying.
      if (since === null) {
        this.options.onError(
          response.status === 403
            ? "this project is not shared with you"
            : "could not load the project"
        );
      }
      return;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 0) applyRemote(this.doc, bytes);

    this.advanceSeq(response);
  }

  private advanceSeq(response: Response): void {
    const header = Number(response.headers.get("X-Doc-Seq"));
    if (Number.isFinite(header) && header > this.seq) this.seq = header;
  }

  /**
   * Sends accumulated local updates as one merged update.
   *
   * On failure they go back on the queue rather than being dropped. The
   * document on screen has already moved, so losing the update would leave
   * this client permanently ahead of everyone else with no sign of it.
   */
  private async flush(): Promise<void> {
    if (this.outbound.length === 0) return;

    const batch = this.outbound;
    this.outbound = [];

    const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);

    try {
      const response = await fetch(projectUrl(this.options.projectId, "/doc"), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: merged as unknown as BodyInit
      });

      if (!response.ok) throw new Error(String(response.status));
      // A POST acknowledges only this client's update. Another client may
      // have appended an unseen update immediately before it, so only GETs
      // may advance the receive high-water mark. Re-pulling our own update is
      // harmless because Yjs updates are idempotent.
    } catch {
      this.outbound.unshift(merged);

      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.flush();
        }, FLUSH_MS * 8);
      }
    }
  }
}
