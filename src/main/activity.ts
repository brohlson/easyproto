import { ProjectError } from "./project";

export const activityLeaseMs = 120_000;
const maxLeases = 128;

export class ArtboardActivity {
  #leases = new Map<string, { artboardId: string; timer: NodeJS.Timeout }>();
  #running = new Map<string, number>();

  constructor(
    private readonly signal: AbortSignal,
    private readonly changed: () => void,
  ) {
    signal.addEventListener(
      "abort",
      () => {
        for (const { timer } of this.#leases.values()) clearTimeout(timer);
        this.#leases.clear();
        this.#running.clear();
      },
      { once: true },
    );
  }

  isWorking(artboardId: string) {
    if (this.#running.has(artboardId)) return true;
    for (const lease of this.#leases.values()) {
      if (lease.artboardId === artboardId) return true;
    }
    return false;
  }

  #notify(artboardId: string, wasWorking: boolean) {
    const working = this.isWorking(artboardId);
    if (!this.signal.aborted && working !== wasWorking) this.changed();
    return working;
  }

  set(artboardId: string, activityId: string, working: boolean) {
    const key = `${artboardId}:${activityId}`;
    const wasWorking = this.isWorking(artboardId);
    const lease = this.#leases.get(key);
    if (working && !lease && this.#leases.size >= maxLeases) {
      throw new ProjectError(
        "ACTIVITY_LIMIT",
        "Too many active artboard activities. End one or wait for it to expire.",
      );
    }
    if (lease) clearTimeout(lease.timer);
    if (working) {
      const timer = setTimeout(() => this.set(artboardId, activityId, false), activityLeaseMs);
      timer.unref();
      this.#leases.set(key, { artboardId, timer });
    } else {
      this.#leases.delete(key);
    }
    return this.#notify(artboardId, wasWorking);
  }

  async run<T>(artboardId: string, job: () => Promise<T>) {
    const wasWorking = this.isWorking(artboardId);
    this.#running.set(artboardId, (this.#running.get(artboardId) ?? 0) + 1);
    this.#notify(artboardId, wasWorking);
    try {
      return await job();
    } finally {
      const count = this.#running.get(artboardId) ?? 0;
      if (count <= 1) this.#running.delete(artboardId);
      else this.#running.set(artboardId, count - 1);
      this.#notify(artboardId, true);
    }
  }
}
