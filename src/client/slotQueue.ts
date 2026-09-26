/**
 * Runs work per key, one batch at a time. Everything queued while a batch is
 * running goes out together as the next batch, so dropping five images onto a
 * busy slot costs one more export, not five. Different keys run in parallel.
 */
export interface SlotQueue<E> {
  enqueue(key: string, edit: E): Promise<void>;
  pending(key: string): number;
}

interface Lane<E> {
  edits: E[];
  waiters: Array<() => void>;
  running: boolean;
}

export function createSlotQueue<E>(
  run: (key: string, edits: E[]) => Promise<void>,
  onChange: (key: string, queued: number, running: boolean) => void = () => undefined
): SlotQueue<E> {
  const lanes = new Map<string, Lane<E>>();

  const drain = async (key: string, lane: Lane<E>): Promise<void> => {
    lane.running = true;
    while (lane.edits.length > 0) {
      const edits = lane.edits.splice(0);
      const waiters = lane.waiters.splice(0);
      onChange(key, 0, true);
      try {
        await run(key, edits);
      } catch {
        // `run` reports its own failures; the lane keeps going.
      }
      for (const done of waiters) done();
    }
    lane.running = false;
    lanes.delete(key);
    onChange(key, 0, false);
  };

  return {
    enqueue(key, edit) {
      const lane = lanes.get(key) ?? { edits: [], waiters: [], running: false };
      lanes.set(key, lane);
      lane.edits.push(edit);
      const settled = new Promise<void>((resolve) => lane.waiters.push(resolve));
      if (lane.running) onChange(key, lane.edits.length, true);
      else void drain(key, lane);
      return settled;
    },

    pending(key) {
      return lanes.get(key)?.edits.length ?? 0;
    }
  };
}
