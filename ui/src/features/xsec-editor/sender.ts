// Latest-value-wins sender for drag gestures. At most one request is in flight;
// while it runs, newer values replace older ones, so the engine never queues a
// backlog and the final value always lands. Starts are spaced by minIntervalMs
// (about 30 calls per second by default).

export interface LatestSender<T> {
  /** Queue a value. Sends immediately when idle. */
  push(value: T): void;
  /** Resolves once the queued value has been sent and answered. */
  flush(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function latestSender<T>(send: (value: T) => Promise<unknown>, minIntervalMs = 33): LatestSender<T> {
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;
  let lastStart = 0;

  const run = async (): Promise<void> => {
    while (pending) {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      const job = pending;
      pending = null;
      lastStart = Date.now();
      try {
        await send(job.value);
      } catch {
        // The client has already reported engine errors; keep draining.
      }
    }
    running = null;
  };

  return {
    push(value) {
      pending = { value };
      if (running === null) running = run();
    },
    async flush() {
      while (running !== null) await running;
    },
  };
}
