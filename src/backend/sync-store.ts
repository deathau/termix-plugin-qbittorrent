/**
 * Holds the merged result of qBittorrent's /sync/maindata replies.
 *
 * qBittorrent sends deltas: only changed fields per torrent, plus lists of
 * removed torrents. When the rid we send differs from the one it last answered
 * with, it sends everything and sets `full_update`. A full update replaces our
 * state; it is not merged into it, otherwise torrents deleted in the meantime
 * would linger. No assumption is made that replies are ever incremental.
 */
import type {
  MainDataUpdate,
  QbtServerState,
  QbtTorrentPatch,
} from "./qbittorrent/client.js";

/** qBittorrent reports an unknown or infinite ETA as this many seconds. */
export const ETA_INFINITY = 8_640_000;

export interface TorrentRow {
  hash: string;
  name: string;
  state: string;
  /** 0 to 1. */
  progress: number;
  size: number;
  downloadSpeed: number;
  uploadSpeed: number;
  /** Seconds, or null when unknown or infinite. */
  eta: number | null;
  ratio: number;
  seeds: number;
  leechers: number;
  category: string;
  tags: string[];
  addedOn: number;
}

export interface ServerStateRow {
  downloadSpeed: number;
  uploadSpeed: number;
  /** Bytes per second; 0 means no limit. */
  downloadLimit: number;
  uploadLimit: number;
  altSpeedEnabled: boolean;
  connectionStatus: string;
}

export interface Snapshot {
  torrents: TorrentRow[];
  serverState: ServerStateRow;
  categories: string[];
  tags: string[];
  /** For diagnosing whether qBittorrent is answering incrementally. */
  sync: { rid: number; fullUpdate: boolean };
}

export class SyncStore {
  #rid = 0;
  #lastWasFull = false;
  #torrents = new Map<string, QbtTorrentPatch>();
  #categories = new Set<string>();
  #tags = new Set<string>();
  #serverState: Partial<QbtServerState> = {};

  /** The rid to send with the next request. 0 asks for a full snapshot. */
  get rid(): number {
    return this.#rid;
  }

  apply(update: MainDataUpdate): void {
    if (update.full_update) this.#clearData();

    for (const [hash, patch] of Object.entries(update.torrents ?? {})) {
      const current = this.#torrents.get(hash);
      this.#torrents.set(
        hash,
        current ? { ...current, ...patch } : { ...patch },
      );
    }
    for (const hash of update.torrents_removed ?? [])
      this.#torrents.delete(hash);

    for (const name of Object.keys(update.categories ?? {}))
      this.#categories.add(name);
    for (const name of update.categories_removed ?? [])
      this.#categories.delete(name);
    for (const tag of update.tags ?? []) this.#tags.add(tag);
    for (const tag of update.tags_removed ?? []) this.#tags.delete(tag);

    this.#serverState = { ...this.#serverState, ...update.server_state };
    this.#rid = update.rid;
    this.#lastWasFull = update.full_update === true;
  }

  /** Forget everything, so the next request asks for a full snapshot. */
  reset(): void {
    this.#clearData();
    this.#rid = 0;
    this.#lastWasFull = false;
  }

  snapshot(): Snapshot {
    const s = this.#serverState;
    return {
      torrents: [...this.#torrents].map(([hash, t]) => toRow(hash, t)),
      serverState: {
        downloadSpeed: s.dl_info_speed ?? 0,
        uploadSpeed: s.up_info_speed ?? 0,
        downloadLimit: s.dl_rate_limit ?? 0,
        uploadLimit: s.up_rate_limit ?? 0,
        altSpeedEnabled: s.use_alt_speed_limits === true,
        connectionStatus: s.connection_status ?? "unknown",
      },
      categories: [...this.#categories].sort(),
      tags: [...this.#tags].sort(),
      sync: { rid: this.#rid, fullUpdate: this.#lastWasFull },
    };
  }

  #clearData(): void {
    this.#torrents.clear();
    this.#categories.clear();
    this.#tags.clear();
    this.#serverState = {};
  }
}

function toRow(hash: string, t: QbtTorrentPatch): TorrentRow {
  return {
    hash,
    name: t.name ?? hash,
    state: t.state ?? "unknown",
    progress: t.progress ?? 0,
    size: t.size ?? 0,
    downloadSpeed: t.dlspeed ?? 0,
    uploadSpeed: t.upspeed ?? 0,
    eta: t.eta === undefined || t.eta >= ETA_INFINITY ? null : t.eta,
    ratio: t.ratio ?? 0,
    seeds: t.num_seeds ?? 0,
    leechers: t.num_leechs ?? 0,
    category: t.category ?? "",
    tags: (t.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    addedOn: t.added_on ?? 0,
  };
}
