/**
 * SDK-independent route logic. Each handler takes plain dependencies and
 * returns `{ status, body }`, so routes.ts only has to adapt the SDK's request
 * and response objects, resolve permissions, and supply the dependencies.
 */
import {
  QbtClient,
  QbtError,
  type ConnectionInfo,
  type FetchLike,
  type QbtErrorKind,
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
  if (!resolved.ok) return { status: 200, body: resolved };
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
  if (!resolved.ok) return { status: 200, body: resolved };
  try {
    const snapshot = await service.snapshot(resolved.client);
    return { status: 200, body: { ok: true, ...snapshot } };
  } catch (err) {
    return connectionFailure(err);
  }
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
