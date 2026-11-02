/**
 * Types and pure helpers for the torrent list: no React, no SDK, so they can
 * be tested on their own.
 *
 * The types mirror the body of GET /torrents (src/backend/handlers.ts and
 * src/backend/sync-store.ts). They are copied rather than imported so the
 * frontend bundle does not depend on backend code; keep the two in step.
 */

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
  downloadLimit: number;
  uploadLimit: number;
  altSpeedEnabled: boolean;
  connectionStatus: string;
}

export interface TorrentsOk {
  ok: true;
  torrents: TorrentRow[];
  serverState: ServerStateRow;
  categories: string[];
  tags: string[];
  sync: { rid: number; fullUpdate: boolean };
}

export type TorrentsBody =
  TorrentsOk | { ok: false; error: { kind: string; message: string } };

// --- State groups and filtering ---------------------------------------------

export type Filter = "all" | "downloading" | "seeding" | "paused" | "errored";
export const FILTERS: Filter[] = [
  "all",
  "downloading",
  "seeding",
  "paused",
  "errored",
];

type Group = Exclude<Filter, "all"> | "other";

// qBittorrent's API reference lists pausedUP/pausedDL; newer versions may
// report stoppedUP/stoppedDL for the same thing. Both are accepted.
const GROUPS: Record<string, Group> = {
  downloading: "downloading",
  metaDL: "downloading",
  forcedMetaDL: "downloading",
  forcedDL: "downloading",
  stalledDL: "downloading",
  queuedDL: "downloading",
  checkingDL: "downloading",
  allocating: "downloading",
  uploading: "seeding",
  stalledUP: "seeding",
  forcedUP: "seeding",
  queuedUP: "seeding",
  checkingUP: "seeding",
  pausedDL: "paused",
  pausedUP: "paused",
  stoppedDL: "paused",
  stoppedUP: "paused",
  error: "errored",
  missingFiles: "errored",
};

export function stateGroup(state: string): Group {
  return GROUPS[state] ?? "other";
}

export function matchesFilter(
  row: TorrentRow,
  filter: Filter,
  query: string,
): boolean {
  if (filter !== "all" && stateGroup(row.state) !== filter) return false;
  const q = query.trim().toLowerCase();
  return q === "" || row.name.toLowerCase().includes(q);
}

export function countByFilter(rows: TorrentRow[]): Record<Filter, number> {
  const counts: Record<Filter, number> = {
    all: rows.length,
    downloading: 0,
    seeding: 0,
    paused: 0,
    errored: 0,
  };
  for (const row of rows) {
    const group = stateGroup(row.state);
    if (group !== "other") counts[group]++;
  }
  return counts;
}

// --- Sorting -----------------------------------------------------------------

export type SortKey =
  | "name"
  | "state"
  | "progress"
  | "size"
  | "downloadSpeed"
  | "uploadSpeed"
  | "eta"
  | "ratio"
  | "addedOn";
export type SortDir = "asc" | "desc";

/** Returns a sorted copy. Ties fall back to the name so the order is stable between polls. */
export function sortRows(
  rows: TorrentRow[],
  key: SortKey,
  dir: SortDir,
): TorrentRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const byName = (a: TorrentRow, b: TorrentRow) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  return [...rows].sort((a, b) => {
    let diff: number;
    if (key === "name") {
      diff = byName(a, b);
    } else if (key === "state") {
      diff = a.state.localeCompare(b.state);
    } else if (key === "eta") {
      // An unknown ETA sorts after every known one when ascending.
      diff =
        (a.eta ?? Number.POSITIVE_INFINITY) ===
        (b.eta ?? Number.POSITIVE_INFINITY)
          ? 0
          : (a.eta ?? Number.POSITIVE_INFINITY) <
              (b.eta ?? Number.POSITIVE_INFINITY)
            ? -1
            : 1;
    } else {
      diff = a[key] - b[key];
    }
    return diff !== 0 ? diff * sign : byName(a, b);
  });
}

// --- Formatting --------------------------------------------------------------

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "\u2014";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${UNITS[unit]}`;
}

/** Zero is shown as a dash so idle torrents don't clutter the table. */
export function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : "\u2014";
}

export function formatEta(seconds: number | null): string {
  if (seconds === null) return "\u221e";
  const s = Math.max(0, Math.round(seconds));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function formatRatio(ratio: number): string {
  return ratio < 0 ? "\u2014" : ratio.toFixed(2);
}

/** Rounds down so a torrent at 99.96% never shows as 100.0%. */
export function formatPercent(progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress));
  return `${(Math.floor(clamped * 1000) / 10).toFixed(1)}%`;
}
