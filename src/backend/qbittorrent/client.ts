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
  | "unsupported";

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
    const text = await this.#get(`sync/maindata?rid=${safeRid}`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw this.#notQbittorrent();
    }
    if (
      typeof json !== "object" ||
      json === null ||
      typeof (json as { rid?: unknown }).rid !== "number"
    ) {
      throw this.#notQbittorrent();
    }
    return json as MainDataUpdate;
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

  async #get(path: string): Promise<string> {
    const url = `${this.baseUrl}/api/v2/${path}`;
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: "*/*" },
        // Termix's ctx.fetch never follows redirects, so behave the same everywhere.
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new QbtError(
          "timeout",
          `qBittorrent did not answer within ${formatDuration(this.#timeoutMs)} at ${this.baseUrl}.`,
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
