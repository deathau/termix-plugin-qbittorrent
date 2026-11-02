/**
 * Minimal qBittorrent WebUI API client.
 *
 * Targets qBittorrent 5.2+ and authenticates with an API key sent as an
 * `Authorization: Bearer` header, so there is no cookie session to manage.
 *
 * Redirects are never followed (Termix's ctx.fetch doesn't either); a proxy
 * that redirects, for example HTTP to HTTPS, produces a clear error.
 *
 * This file deliberately imports nothing from the Termix SDK. The HTTP
 * transport is injected: in the plugin, pass the permission-gated outbound
 * fetch (`network:outbound`); in tests, pass a fake.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type QbtErrorKind =
  | "invalid-url"
  | "missing-key"
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "http"
  | "redirect"
  | "unexpected"
  | "unsupported"
  | "bad-request"
  | "not-found"
  | "conflict";

export class QbtError extends Error {
  readonly kind: QbtErrorKind;
  readonly status?: number;

  constructor(kind: QbtErrorKind, message: string, status?: number) {
    super(message);
    this.name = "QbtError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Oldest WebAPI version this plugin will talk to. `/torrents/stop` and
 * `/torrents/start` replaced pause/resume in qBittorrent 5.0 (WebAPI 2.11).
 * API-key auth itself already implies 5.2+, which the server enforces.
 */
export const MIN_WEBAPI_VERSION = "2.11.0";

const DEFAULT_TIMEOUT_MS = 10_000;
/** qBittorrent may fetch a URL before it answers /torrents/add. */
const ADD_TIMEOUT_MS = 30_000;

/** Validate a user-entered WebUI address and strip trailing slashes, query and hash. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new QbtError(
      "invalid-url",
      "The qBittorrent URL is not valid. Use a full address such as http://qbittorrent:8080.",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new QbtError(
      "invalid-url",
      "The qBittorrent URL must start with http:// or https://.",
    );
  }
  if (url.username || url.password) {
    throw new QbtError(
      "invalid-url",
      "Do not put credentials in the qBittorrent URL. Use the API key setting instead.",
    );
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** Compare dotted numeric versions. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface QbtClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface ConnectionInfo {
  /** Application version as reported by qBittorrent, for example "v5.3.0". */
  appVersion: string;
  /** WebAPI version, for example "2.15.1". */
  webApiVersion: string;
}

/** Per-torrent fields the plugin reads from /sync/maindata (qBittorrent WebUI API). */
export interface QbtTorrent {
  name: string;
  /** For example "downloading", "stalledUP", "stoppedDL". */
  state: string;
  /** 0 to 1. */
  progress: number;
  /** Bytes selected for download. */
  size: number;
  /** Bytes per second. */
  dlspeed: number;
  upspeed: number;
  /** Seconds; 8640000 means "never". */
  eta: number;
  ratio: number;
  num_seeds: number;
  num_leechs: number;
  category: string;
  /** Comma-separated. */
  tags: string;
  /** Unix seconds. */
  added_on: number;
  /** Queue position, from 1. Not positive when queueing is off or the torrent is seeding. */
  priority: number;
  save_path: string;
  /** The torrent's root folder, or its file for a single-file torrent. */
  content_path: string;
}

/** Updates carry only the fields that changed. */
export type QbtTorrentPatch = Partial<QbtTorrent>;

export interface QbtServerState {
  dl_info_speed: number;
  up_info_speed: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  connection_status: string;
  use_alt_speed_limits: boolean;
  queueing: boolean;
}

/** One reply from `GET /sync/maindata`. */
export interface MainDataUpdate {
  rid: number;
  /** True when the reply is complete rather than a delta. */
  full_update?: boolean;
  torrents?: Record<string, QbtTorrentPatch>;
  torrents_removed?: string[];
  categories?: Record<string, { name?: string }>;
  categories_removed?: string[];
  tags?: string[];
  tags_removed?: string[];
  server_state?: Partial<QbtServerState>;
}

/** Actions that take only `hashes`, plus setForceStart, which also takes `value`. */
export const TORRENT_ACTIONS = [
  "start",
  "stop",
  "recheck",
  "reannounce",
  "increasePrio",
  "decreasePrio",
  "topPrio",
  "bottomPrio",
  "setForceStart",
] as const;
export type TorrentAction = (typeof TORRENT_ACTIONS)[number];

const QUEUE_ACTIONS: readonly TorrentAction[] = [
  "increasePrio",
  "decreasePrio",
  "topPrio",
  "bottomPrio",
];

export interface AddTorrentsOptions {
  /** Magnet links or http(s) URLs. */
  urls: string[];
  savePath?: string;
  category?: string;
  tags?: string[];
  stopped?: boolean;
}

export interface AddTorrentsResult {
  added: number;
  failed: number;
  /** URLs qBittorrent is still fetching. */
  pending: number;
}

/** The fields of /torrents/properties the plugin shows. -1 means unknown. */
export interface QbtProperties {
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

export interface QbtFile {
  index: number;
  /** Relative path. Contains "/" when the torrent has a root folder. */
  name: string;
  size: number;
  progress: number;
  /** 0 skip, 1 normal, 6 high, 7 maximum. */
  priority: number;
}

export interface QbtTracker {
  url: string;
  /** 0 disabled (DHT, PeX, LSD), 1 not contacted, 2 working, 3 updating, 4 not working. */
  status: number;
  /** Negative for the DHT, PeX and LSD placeholder entries. */
  tier: number;
  num_peers: number;
  num_seeds: number;
  num_leeches: number;
  msg: string;
}

interface RequestOptions {
  method?: "GET" | "POST";
  /** Sent urlencoded. */
  form?: Record<string, string>;
  timeoutMs?: number;
  /** Replaces the generic message for a 409, whose meaning depends on the endpoint. */
  conflictMessage?: string;
}

export class QbtClient {
  readonly baseUrl: string;
  // A true private field keeps the key out of JSON.stringify and console.log output.
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(options: QbtClientOptions) {
    const apiKey = options.apiKey?.trim();
    if (!apiKey) {
      throw new QbtError(
        "missing-key",
        "An API key is required. Create one in the qBittorrent WebUI settings (qBittorrent 5.2 or newer).",
      );
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#apiKey = apiKey;
    this.#fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** `GET /app/version`, for example "v5.3.0". */
  async getAppVersion(): Promise<string> {
    return (await this.#get("app/version")).trim();
  }

  /** `GET /app/webapiVersion`, for example "2.15.1". Requires auth, so it doubles as a key check. */
  async getWebApiVersion(): Promise<string> {
    const text = (await this.#get("app/webapiVersion")).trim();
    if (!/^\d+(\.\d+){1,2}$/.test(text)) {
      // A reverse proxy or SSO page can answer 200 with HTML. Don't treat that as qBittorrent.
      throw this.#notQbittorrent();
    }
    return text;
  }

  /**
   * `GET /sync/maindata?rid=...`. Pass 0 for a full snapshot, or the `rid` of
   * the previous reply for changes since then. qBittorrent decides whether the
   * reply is complete (`full_update`), so callers must handle both.
   */
  async getMainData(rid: number): Promise<MainDataUpdate> {
    const safeRid = Number.isFinite(rid) ? Math.max(0, Math.trunc(rid)) : 0;
    const json = this.#parseJson(
      await this.#get(`sync/maindata?rid=${safeRid}`),
    );
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { rid?: unknown }).rid !== "number"
    ) {
      throw this.#notQbittorrent();
    }
    return json as MainDataUpdate;
  }

  /** `POST /torrents/<action>`. Unknown hashes are ignored by qBittorrent. */
  async torrentAction(
    action: TorrentAction,
    hashes: string[],
    value?: boolean,
  ): Promise<void> {
    const form: Record<string, string> = { hashes: hashes.join("|") };
    if (action === "setForceStart") form.value = String(value ?? true);
    await this.#request(`torrents/${action}`, {
      method: "POST",
      form,
      conflictMessage: QUEUE_ACTIONS.includes(action)
        ? "Torrent queueing is turned off in qBittorrent, so queue positions can't be changed."
        : undefined,
    });
  }

  /** `POST /torrents/delete`. With `deleteFiles`, the downloaded data goes too. */
  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.#request("torrents/delete", {
      method: "POST",
      form: { hashes: hashes.join("|"), deleteFiles: String(deleteFiles) },
    });
  }

  /**
   * `POST /torrents/add` for magnet links and URLs. `.torrent` files are not
   * supported: Termix's ctx.fetch takes a string body, which can't carry them.
   *
   * qBittorrent answers 409 when nothing was added, whether the links were
   * invalid or the torrents are already in the list. Recent versions answer with JSON counts, older
   * ones with "Ok." or "Fails.".
   */
  async addTorrents(options: AddTorrentsOptions): Promise<AddTorrentsResult> {
    const form: Record<string, string> = { urls: options.urls.join("\n") };
    if (options.savePath) form.savepath = options.savePath;
    if (options.category) form.category = options.category;
    if (options.tags?.length) form.tags = options.tags.join(",");
    if (options.stopped) form.stopped = "true";

    const text = await this.#request("torrents/add", {
      method: "POST",
      form,
      timeoutMs: Math.max(this.#timeoutMs, ADD_TIMEOUT_MS),
      conflictMessage:
        "qBittorrent didn't add anything. The links may be invalid, or the torrents may already be in the list.",
    });

    const count = options.urls.length;
    if (text.trim() === "Ok.") return { added: count, failed: 0, pending: 0 };
    if (text.trim() === "Fails.")
      return { added: 0, failed: count, pending: 0 };
    const json = this.#parseJson(text) as {
      success_count?: number;
      failure_count?: number;
      pending_count?: number;
    } | null;
    return {
      added: json?.success_count ?? 0,
      failed: json?.failure_count ?? 0,
      pending: json?.pending_count ?? 0,
    };
  }

  async getProperties(hash: string): Promise<QbtProperties> {
    return this.#parseJson(
      await this.#get(`torrents/properties?hash=${encodeURIComponent(hash)}`),
    ) as QbtProperties;
  }

  async getFiles(hash: string): Promise<QbtFile[]> {
    return this.#parseJson(
      await this.#get(`torrents/files?hash=${encodeURIComponent(hash)}`),
    ) as QbtFile[];
  }

  async getTrackers(hash: string): Promise<QbtTracker[]> {
    return this.#parseJson(
      await this.#get(`torrents/trackers?hash=${encodeURIComponent(hash)}`),
    ) as QbtTracker[];
  }

  #parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw this.#notQbittorrent();
    }
  }

  #notQbittorrent(): QbtError {
    return new QbtError(
      "unexpected",
      `${this.baseUrl} answered, but it does not look like the qBittorrent WebUI API. Check the URL and any reverse proxy in front of it.`,
    );
  }

  /** Verify the URL, the key and the version in one go. */
  async testConnection(): Promise<ConnectionInfo> {
    const webApiVersion = await this.getWebApiVersion();
    if (compareVersions(webApiVersion, MIN_WEBAPI_VERSION) < 0) {
      throw new QbtError(
        "unsupported",
        `qBittorrent WebAPI ${webApiVersion} is too old. This plugin needs qBittorrent 5.2 or newer.`,
      );
    }
    const appVersion = await this.getAppVersion();
    return { appVersion, webApiVersion };
  }

  #get(path: string): Promise<string> {
    return this.#request(path);
  }

  async #request(path: string, options: RequestOptions = {}): Promise<string> {
    const url = `${this.baseUrl}/api/v2/${path}`;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "*/*",
    };
    if (options.form)
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: options.method ?? "GET",
        headers,
        ...(options.form
          ? { body: new URLSearchParams(options.form).toString() }
          : {}),
        // Termix's ctx.fetch never follows redirects, so behave the same everywhere.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new QbtError(
          "timeout",
          `qBittorrent did not answer within ${formatDuration(timeoutMs)} at ${this.baseUrl}.`,
        );
      }
      throw new QbtError(
        "network",
        `Could not reach qBittorrent at ${this.baseUrl}: ${describeNetworkError(err)}`,
      );
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      throw new QbtError(
        "redirect",
        `qBittorrent answered with a redirect (${res.status})${location ? ` to ${location}` : ""}. Redirects are not followed, so use the final address as the URL.`,
        res.status,
      );
    }
    if (res.status === 401) {
      throw new QbtError(
        "unauthorized",
        "qBittorrent asked for authentication (401). Check the API key.",
        401,
      );
    }
    if (res.status === 403) {
      throw new QbtError(
        "forbidden",
        "qBittorrent rejected the request (403). The API key may be wrong, or qBittorrent is older than 5.2 and does not support API keys.",
        403,
      );
    }
    if (res.status === 400 || res.status === 415) {
      throw new QbtError(
        "bad-request",
        `qBittorrent refused the request (${res.status}).`,
        res.status,
      );
    }
    if (res.status === 404) {
      throw new QbtError(
        "not-found",
        "qBittorrent no longer has that torrent.",
        404,
      );
    }
    if (res.status === 409) {
      throw new QbtError(
        "conflict",
        options.conflictMessage ??
          "qBittorrent can't do that in the torrent's current state.",
        409,
      );
    }
    if (!res.ok) {
      throw new QbtError(
        "http",
        `qBittorrent answered ${res.status} for ${path}.`,
        res.status,
      );
    }
    return res.text();
  }
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function describeNetworkError(err: unknown): string {
  // Node's fetch reports "fetch failed" and puts the useful code on `cause`.
  const cause = (
    err as { cause?: { code?: unknown; message?: unknown } } | null
  )?.cause;
  if (typeof cause?.code === "string") return cause.code;
  if (typeof cause?.message === "string") return cause.message;
  if (err instanceof Error) return err.message;
  return "unknown error";
}
