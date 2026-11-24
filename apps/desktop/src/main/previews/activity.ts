import { ProjectError } from "../document/project";

export const activityLeaseMs = 120_000;
const maxLeases = 128;

export class ArtboardActivity {
  #leases = new Map<string, { artboardId: string; timer: NodeJS.Timeout }>();
  #running = new Map<string, number>();
  #presenting = new Map<string, { since: number; timer?: NodeJS.Timeout }>();
  #sequence = 0;
  focus?: { sequence: number; artboardIds: string[] };

  constructor(
    private readonly signal: AbortSignal,
    private readonly changed: () => void,
    private readonly minimumMs = 1200,
  ) {
    signal.addEventListener(
      "abort",
      () => {
        for (const { timer } of this.#leases.values()) clearTimeout(timer);
        this.#leases.clear();
        this.#running.clear();
        for (const entry of this.#presenting.values()) clearTimeout(entry.timer);
        this.#presenting.clear();
        this.focus = undefined;
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

  isPresenting(artboardId: string) {
    return this.#presenting.has(artboardId);
  }

  #present(ids: string[]) {
    const fresh = ids.some((id) => !this.#presenting.has(id));
    for (const id of ids) {
      const entry = this.#presenting.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      } else this.#presenting.set(id, { since: Date.now() });
    }
    if (fresh) this.focus = { sequence: ++this.#sequence, artboardIds: [...ids] };
  }

  #settle(id: string) {
    const entry = this.#presenting.get(id);
    if (!entry || entry.timer || this.isWorking(id)) return;
    const remaining = entry.since + this.minimumMs - Date.now();
    if (remaining <= 0) this.#presenting.delete(id);
    else {
      entry.timer = setTimeout(() => {
        this.#presenting.delete(id);
        if (!this.signal.aborted) this.changed();
      }, remaining);
      entry.timer.unref();
    }
  }

  pruneLeases(exists: (artboardId: string) => boolean) {
    for (const [key, lease] of this.#leases) {
      if (exists(lease.artboardId)) continue;
      clearTimeout(lease.timer);
      this.#leases.delete(key);
    }
    for (const [id, entry] of this.#presenting) {
      if (exists(id)) continue;
      clearTimeout(entry.timer);
      this.#presenting.delete(id);
    }
  }

  #notify(artboardId: string, wasWorking: boolean) {
    const working = this.isWorking(artboardId);
    if (!this.signal.aborted && working !== wasWorking) {
      if (working) this.#present([artboardId]);
      else this.#settle(artboardId);
      this.changed();
    }
    return working;
  }

  set(artboardId: string, activityId: string, working: boolean) {
    if (this.signal.aborted) return false;
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

  begin(ids: string[]) {
    if (this.signal.aborted) return () => {};
    const started = ids.some((id) => !this.isWorking(id));
    for (const id of ids) this.#running.set(id, (this.#running.get(id) ?? 0) + 1);
    if (started && !this.signal.aborted) {
      this.#present(ids);
      this.changed();
    }
    return () => {
      for (const id of ids) {
        const count = this.#running.get(id) ?? 0;
        if (count <= 1) this.#running.delete(id);
        else this.#running.set(id, count - 1);
      }
      if (!this.signal.aborted && ids.some((id) => !this.isWorking(id))) {
        for (const id of ids) this.#settle(id);
        this.changed();
      }
    };
  }

  async run<T>(artboardId: string, job: () => Promise<T>) {
    const finish = this.begin([artboardId]);
    try {
      return await job();
    } finally {
      finish();
    }
  }
}
