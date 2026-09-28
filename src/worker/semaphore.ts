/**
 * At most `limit` callers inside `run` at once; the rest wait their turn in
 * arrival order.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }

    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter rather than releasing it, so
      // a newcomer cannot jump the queue between the release and the wake-up.
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
