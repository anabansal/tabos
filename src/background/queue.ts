/**
 * Runs async tasks one at a time, in order. Chrome events and user actions both go through
 * the same queue so, e.g., an onCreated event can never race a restore that is binding the
 * very same tab to its record.
 *
 * Tasks must not enqueue-and-await other tasks (that would deadlock); internal operations are
 * plain functions that assume they already hold the queue.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  run<T>(task: () => Promise<T>, label = 'task'): Promise<T> {
    this.depth++;
    const next = this.tail.then(task, task).finally(() => {
      this.depth--;
    });
    this.tail = next.catch((err) => {
      console.error(`[TabOS] ${label} failed`, err);
    });
    return next;
  }

  get pending(): number {
    return this.depth;
  }

  /** Resolves once everything queued so far has finished. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

export const queue = new SerialQueue();
