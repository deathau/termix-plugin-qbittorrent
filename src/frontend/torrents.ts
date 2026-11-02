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
  /** Queue position, or null when queueing is off or the torrent is seeding. */
  priority: number | null;
  savePath: string;
  contentPath: string;
}

export interface ServerStateRow {
  downloadSpeed: number;
  uploadSpeed: number;
  downloadLimit: number;
  uploadLimit: number;
  altSpeedEnabled: boolean;
  connectionStatus: string;
  queueing: boolean;
}

export interface TorrentsOk {
  ok: true;
  torrents: TorrentRow[];
  serverState: ServerStateRow;
  categories: string[];
  tags: string[];
  sync: { rid: number; fullUpdate: boolean };
}

export interface ErrorBody {
  ok: false;
  error: { kind: string; message: string };
}

export type TorrentsBody = TorrentsOk | ErrorBody;
export type DoneBody = { ok: true } | ErrorBody;
export type AddBody =
  | ({ ok: true } & { added: number; failed: number; pending: number })
  | ErrorBody;

export type TorrentAction =
  | "start"
  | "stop"
  | "recheck"
  | "reannounce"
  | "increasePrio"
  | "decreasePrio"
  | "topPrio"
  | "bottomPrio"
  | "setForceStart";

export interface TorrentProperties {
  save_path: string;
  comment: string;
  created_by: string;
  creation_date: number;
  addition_date: number;
  completion_date: number;
  total_size: number;
  total_downloaded: number;
  total_uploaded: number;
  piece_size: number;
  pieces_have: number;
  pieces_num: number;
  share_ratio: number;
  time_elapsed: number;
  seeding_time: number;
  nb_connections: number;
}

export interface TorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
}

export interface TorrentTracker {
  url: string;
  status: number;
  tier: number;
  num_peers: number;
  num_seeds: number;
  num_leeches: number;
  msg: string;
}

export interface DetailsOk {
  ok: true;
  properties: TorrentProperties;
  files: TorrentFile[];
  trackers: TorrentTracker[];
}

export type DetailsBody = DetailsOk | ErrorBody;

export interface LocationConfig {
  hostId: string | null;
  qbtPrefix: string;
  hostPrefix: string;
}

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
  | "addedOn"
  | "priority";
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
    // Torrents outside the queue stay after the queue whichever way it runs.
    if (key === "priority" && (a.priority === null) !== (b.priority === null))
      return a.priority === null ? 1 : -1;
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
    } else if (key === "priority") {
      diff = (a.priority ?? 0) - (b.priority ?? 0);
    } else {
      diff = a[key] - b[key];
    }
    return diff !== 0 ? diff * sign : byName(a, b);
  });
}

// --- Adding -----------------------------------------------------------------

/** One link per line; blank lines are ignored. */
export function parseLinks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// --- Locations ----------------------------------------------------------------

function trimEnd(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/**
 * Swaps the start of a qBittorrent path for the same place on the Termix host.
 * Only whole path segments match, so /downloads leaves /downloads2 alone.
 * A path outside the prefix is returned unchanged.
 */
export function mapPath(path: string, from: string, to: string): string {
  if (!from) return path;
  const base = trimEnd(from);
  const rest = path.slice(base.length);
  const matches =
    path.startsWith(base) &&
    (rest === "" || rest[0] === "/" || rest[0] === "\\");
  if (!matches) return path;
  // A Windows qBittorrent mapped onto a POSIX host needs its separators swapped.
  const tail = from.startsWith("/") ? rest : rest.replace(/\\/g, "/");
  return trimEnd(to) + tail || "/";
}

/** The folder holding `path`, keeping the root of a POSIX or Windows path. */
export function parentPath(path: string): string {
  const trimmed = trimEnd(path);
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return trimmed;
  if (cut === 0) return "/";
  return trimmed.slice(
    0,
    /^[A-Za-z]:$/.test(trimmed.slice(0, cut)) ? cut + 1 : cut,
  );
}

/**
 * The folder to open on the Termix host. A torrent with several files, or a
 * root folder, has one of its own. A single file sits directly in its parent,
 * which is not always savePath while a temporary download folder is in use.
 * With no file list yet (metadata still downloading) only savePath is known.
 */
export function locationPath(
  row: Pick<TorrentRow, "savePath" | "contentPath">,
  files: Pick<TorrentFile, "name">[],
  config: Pick<LocationConfig, "qbtPrefix" | "hostPrefix">,
): string {
  const hasRootFolder = files.length > 1 || /[\\/]/.test(files[0]?.name ?? "");
  const folder =
    files.length === 0 || !row.contentPath
      ? row.savePath
      : hasRootFolder
        ? row.contentPath
        : parentPath(row.contentPath);
  return mapPath(folder, config.qbtPrefix, config.hostPrefix);
}

// --- Details ------------------------------------------------------------------

/** Drops qBittorrent's DHT, PeX and LSD placeholders, which always say "working". */
export function realTrackers(trackers: TorrentTracker[]): TorrentTracker[] {
  return trackers.filter((tracker) => tracker.tier >= 0);
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

/** Unix seconds as a local date and time. Zero and -1 mean unknown. */
export function formatDate(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleString() : "\u2014";
}

export function formatRatio(ratio: number): string {
  return ratio < 0 ? "\u2014" : ratio.toFixed(2);
}

/** Rounds down so a torrent at 99.96% never shows as 100.0%. */
export function formatPercent(progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress));
  return `${(Math.floor(clamped * 1000) / 10).toFixed(1)}%`;
}
