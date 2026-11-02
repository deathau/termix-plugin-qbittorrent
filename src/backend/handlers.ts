/**
 * SDK-independent route logic. Each handler takes plain dependencies and
 * returns `{ status, body }`, so routes.ts only has to adapt the SDK's request
 * and response objects, resolve permissions, and supply the dependencies.
 */
import {
  QbtClient,
  QbtError,
  TORRENT_ACTIONS,
  type AddTorrentsResult,
  type ConnectionInfo,
  type FetchLike,
  type QbtErrorKind,
  type QbtFile,
  type QbtProperties,
  type QbtTracker,
  type TorrentAction,
} from "./qbittorrent/client.js";
import type { TorrentService } from "./service.js";
import type { Snapshot } from "./sync-store.js";

export interface ConnectionDeps {
  /** The admin `baseUrl` setting. */
  getBaseUrl(): Promise<string | undefined> | string | undefined;
  /** The API key from the secret setting. Never log or return it. */
  getApiKey(): Promise<string | undefined> | string | undefined;
  /** The outbound fetch granted by `network:outbound`. Defaults to global fetch. */
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface HandlerResult<T> {
  status: number;
  body: T;
}

export interface ErrorBody {
  ok: false;
  error: { kind: QbtErrorKind | "not-configured"; message: string };
}

export type TestConnectionBody = ({ ok: true } & ConnectionInfo) | ErrorBody;
export type TorrentsBody = ({ ok: true } & Snapshot) | ErrorBody;
export type DoneBody = { ok: true } | ErrorBody;
export type AddBody = ({ ok: true } & AddTorrentsResult) | ErrorBody;
export type DetailsBody =
  | {
      ok: true;
      properties: QbtProperties;
      files: QbtFile[];
      trackers: QbtTracker[];
    }
  | ErrorBody;

const MAX_HASHES = 1000;
const MAX_URLS = 100;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const LINK = /^(?:magnet:\?|https?:\/\/|bc:\/\/bt\/)\S+$/i;

/**
 * POST /test-connection (gate it behind the `manage` permission).
 *
 * Always answers 200 when the handler itself ran. Whether qBittorrent was
 * reachable is reported in the body, so the UI can show the reason inline.
 */
export async function testConnection(
  deps: ConnectionDeps,
): Promise<HandlerResult<TestConnectionBody>> {
  const resolved = await resolveClient(deps);
  if (resolved.ok === false) return { status: 200, body: resolved };
  try {
    const info = await resolved.client.testConnection();
    return { status: 200, body: { ok: true, ...info } };
  } catch (err) {
    return connectionFailure(err);
  }
}

/**
 * GET /torrents (gate it behind the `view` permission).
 *
 * Same convention as testConnection: 200 with `ok: false` and a reason when
 * qBittorrent can't be reached, so the tab can keep showing its last data.
 */
export async function listTorrents(
  deps: ConnectionDeps,
  service: TorrentService,
): Promise<HandlerResult<TorrentsBody>> {
  const resolved = await resolveClient(deps);
  if (resolved.ok === false) return { status: 200, body: resolved };
  try {
    const snapshot = await service.snapshot(resolved.client);
    return { status: 200, body: { ok: true, ...snapshot } };
  } catch (err) {
    return connectionFailure(err);
  }
}

/** POST /torrents/actions (gate it behind `manage`). */
export async function runTorrentAction(
  deps: ConnectionDeps,
  service: TorrentService,
  input: unknown,
): Promise<HandlerResult<DoneBody>> {
  const { action, hashes, value } = (input ?? {}) as {
    action?: unknown;
    hashes?: unknown;
    value?: unknown;
  };
  if (!TORRENT_ACTIONS.includes(action as TorrentAction))
    return badRequest("Unknown action.");
  if (!isHashList(hashes)) return badRequest("Select at least one torrent.");
  if (value !== undefined && typeof value !== "boolean")
    return badRequest("value must be true or false.");
  return run(deps, service, async (client) => {
    await client.torrentAction(
      action as TorrentAction,
      hashes,
      value as boolean | undefined,
    );
    return { ok: true };
  });
}

/** POST /torrents/delete (gate it behind `delete`). */
export async function deleteTorrents(
  deps: ConnectionDeps,
  service: TorrentService,
  input: unknown,
): Promise<HandlerResult<DoneBody>> {
  const { hashes, deleteFiles } = (input ?? {}) as {
    hashes?: unknown;
    deleteFiles?: unknown;
  };
  if (!isHashList(hashes)) return badRequest("Select at least one torrent.");
  // Required rather than defaulted: losing data must never be implied.
  if (typeof deleteFiles !== "boolean")
    return badRequest("deleteFiles must be true or false.");
  return run(deps, service, async (client) => {
    await client.deleteTorrents(hashes as string[], deleteFiles as boolean);
    return { ok: true };
  });
}

/** POST /torrents/add (gate it behind `manage`). */
export async function addTorrents(
  deps: ConnectionDeps,
  service: TorrentService,
  input: unknown,
): Promise<HandlerResult<AddBody>> {
  const { urls, savePath, category, tags, stopped } = (input ?? {}) as {
    urls?: unknown;
    savePath?: unknown;
    category?: unknown;
    tags?: unknown;
    stopped?: unknown;
  };
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > MAX_URLS ||
    !urls.every((url) => typeof url === "string" && LINK.test(url))
  )
    return badRequest(
      `Enter 1 to ${MAX_URLS} magnet links or http(s) URLs, one per line.`,
    );
  if (!isOptionalString(savePath) || !isOptionalString(category))
    return badRequest("The save path and category must be text.");
  if (
    tags !== undefined &&
    !(Array.isArray(tags) && tags.every((tag) => typeof tag === "string"))
  )
    return badRequest("Tags must be a list of text.");
  if (stopped !== undefined && typeof stopped !== "boolean")
    return badRequest("stopped must be true or false.");
  return run(deps, service, async (client) => ({
    ok: true,
    ...(await client.addTorrents({
      urls: urls as string[],
      savePath: savePath as string | undefined,
      category: category as string | undefined,
      tags: tags as string[] | undefined,
      stopped: stopped as boolean | undefined,
    })),
  }));
}

/** GET /torrents/:hash/details (under the router-level `view` gate). */
export async function torrentDetails(
  deps: ConnectionDeps,
  hash: string,
): Promise<HandlerResult<DetailsBody>> {
  if (!HASH.test(hash)) return badRequest("That is not a torrent hash.");
  const resolved = await resolveClient(deps);
  if (resolved.ok === false) return { status: 200, body: resolved };
  try {
    const [properties, files, trackers] = await Promise.all([
      resolved.client.getProperties(hash),
      resolved.client.getFiles(hash),
      resolved.client.getTrackers(hash),
    ]);
    return { status: 200, body: { ok: true, properties, files, trackers } };
  } catch (err) {
    return connectionFailure(err);
  }
}

/** Runs a change, then makes the next list request see its result. */
async function run<T extends { ok: true }>(
  deps: ConnectionDeps,
  service: TorrentService,
  change: (client: QbtClient) => Promise<T>,
): Promise<HandlerResult<T | ErrorBody>> {
  const resolved = await resolveClient(deps);
  if (resolved.ok === false) return { status: 200, body: resolved };
  try {
    const body = await change(resolved.client);
    service.invalidate();
    return { status: 200, body };
  } catch (err) {
    return connectionFailure(err);
  }
}

function isHashList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_HASHES &&
    value.every((hash) => typeof hash === "string" && HASH.test(hash))
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function badRequest(message: string): HandlerResult<ErrorBody> {
  return {
    status: 400,
    body: { ok: false, error: { kind: "bad-request", message } },
  };
}

async function resolveClient(
  deps: ConnectionDeps,
): Promise<{ ok: true; client: QbtClient } | ErrorBody> {
  const baseUrl = (await deps.getBaseUrl())?.trim();
  if (!baseUrl)
    return notConfigured(
      "Set the qBittorrent URL in the plugin settings first.",
    );
  const apiKey = (await deps.getApiKey())?.trim();
  if (!apiKey)
    return notConfigured(
      "Add a qBittorrent API key in the plugin settings first.",
    );
  try {
    return {
      ok: true,
      client: new QbtClient({
        baseUrl,
        apiKey,
        fetch: deps.fetch,
        timeoutMs: deps.timeoutMs,
      }),
    };
  } catch (err) {
    return connectionFailure(err).body;
  }
}

function connectionFailure(err: unknown): HandlerResult<ErrorBody> {
  if (err instanceof QbtError) {
    return {
      status: 200,
      body: { ok: false, error: { kind: err.kind, message: err.message } },
    };
  }
  throw err; // A bug, not a connection problem: let the SDK report a 500.
}

function notConfigured(message: string): ErrorBody {
  return { ok: false, error: { kind: "not-configured", message } };
}
