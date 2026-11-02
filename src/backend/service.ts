/**
 * Shares one upstream qBittorrent poll between every viewer.
 *
 * Nothing runs in the background. A request refreshes the snapshot only when
 * the last refresh is older than `minIntervalMs`, and requests that arrive
 * while a refresh is in flight wait for that one instead of starting another.
 */
import type { QbtClient } from "./qbittorrent/client.js";
import { SyncStore, type Snapshot } from "./sync-store.js";

export interface TorrentServiceOptions {
  /** Requests closer together than this reuse the cached snapshot. */
  minIntervalMs?: number;
  now?: () => number;
}

const DEFAULT_MIN_INTERVAL_MS = 1_500;

export class TorrentService {
  readonly #store = new SyncStore();
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  #lastRefresh = Number.NEGATIVE_INFINITY;
  #inflight: Promise<void> | null = null;
  // Bumped by reset() so a reply to a request made with old settings is dropped.
  #generation = 0;

  constructor(options: TorrentServiceOptions = {}) {
    this.#minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
  }

  /** Call when the URL or key changes: forget the cache and ask for a full snapshot next. */
  reset(): void {
    this.#generation++;
    this.#store.reset();
    this.#lastRefresh = Number.NEGATIVE_INFINITY;
  }

  /** Call after changing torrents, so the next request refreshes instead of reusing the cache. */
  invalidate(): void {
    this.#lastRefresh = Number.NEGATIVE_INFINITY;
  }

  /** Returns the current snapshot, refreshing it first if it is stale. Rejects with a QbtError if qBittorrent can't be reached. */
  async snapshot(client: QbtClient): Promise<Snapshot> {
    if (this.#now() - this.#lastRefresh >= this.#minIntervalMs) {
      await this.#refresh(client);
    }
    return this.#store.snapshot();
  }

  #refresh(client: QbtClient): Promise<void> {
    if (this.#inflight) return this.#inflight;
    const generation = this.#generation;
    const run: Promise<void> = this.#fetchAndApply(client, generation).finally(
      () => {
        if (this.#inflight === run) this.#inflight = null;
      },
    );
    this.#inflight = run;
    return run;
  }

  async #fetchAndApply(client: QbtClient, generation: number): Promise<void> {
    try {
      const update = await client.getMainData(this.#store.rid);
      if (generation !== this.#generation) return;
      this.#store.apply(update);
      this.#lastRefresh = this.#now();
    } catch (err) {
      if (generation === this.#generation) {
        // Start over from a full snapshot rather than trust a half-known state.
        this.#store.reset();
        this.#lastRefresh = Number.NEGATIVE_INFINITY;
      }
      throw err;
    }
  }
}
