/** One REST reconciliation in flight and one pending bit, regardless of trigger count. */
export const SYNC_COALESCE_MS = 100;

export interface TimerClock {
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
}

export const browserClock: TimerClock = {
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (timer) => window.clearTimeout(timer),
};

export class SyncQueue {
  private pending = false;
  private running = false;
  private paused = false;
  private timer: number | undefined;
  private completion: Promise<void> | undefined;
  private finish: (() => void) | undefined;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
    private readonly clock: TimerClock = browserClock,
  ) {}

  request(): Promise<void> {
    if (this.paused) return Promise.resolve();
    this.pending = true;
    // All callers share one completion; hint bursts do not allocate waiters.
    this.completion ??= new Promise<void>((resolve) => { this.finish = resolve; });
    this.schedule();
    return this.completion;
  }

  pause(): void {
    this.paused = true;
    this.pending = false;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) this.settle();
  }

  resume(): void { this.paused = false; }

  private schedule(): void {
    if (this.running || this.timer !== undefined || this.paused) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, SYNC_COALESCE_MS);
  }

  private async drain(): Promise<void> {
    this.running = true;
    this.pending = false;
    try { await this.run(); }
    catch (error) { this.onError(error); }
    finally {
      this.running = false;
      if (this.pending && !this.paused) this.schedule();
      else this.settle();
    }
  }

  private settle(): void {
    const finish = this.finish;
    this.finish = undefined;
    this.completion = undefined;
    finish?.();
  }
}
