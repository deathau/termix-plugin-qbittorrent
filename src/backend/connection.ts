/**
 * The only place that touches the SDK's settings and outbound fetch, so
 * handlers.ts and the client stay testable without Termix.
 */
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { ConnectionDeps } from "./handlers.js";
import type { FetchLike } from "./qbittorrent/client.js";

// ASSUMPTION (not yet confirmed against the SDK types): the Backend docs say
// ctx.fetch refuses private and loopback addresses "unless you list the exact
// host in allowPrivateHosts", but don't say where. This passes it per call.
// If `npm run typecheck` or a real request disagrees, this is the one place
// to change.
type OutboundInit = RequestInit & { allowPrivateHosts?: string[] };
type OutboundFetch = (url: string, init?: OutboundInit) => Promise<Response>;

export function connectionDeps(ctx: PluginContext): ConnectionDeps {
  // The URL is set by an admin and users cannot change it, so allowing exactly
  // that host does not open an SSRF path for other users. Calling through
  // `ctx.fetch(...)` keeps `this` bound.
  const fetch: FetchLike = (input, init) =>
    (ctx.fetch as unknown as OutboundFetch)(input, {
      ...init,
      allowPrivateHosts: [new URL(input).hostname],
    });

  return {
    getBaseUrl: () => ctx.settings.get<string>("baseUrl"),
    getApiKey: () => ctx.settings.get<string>("apiKey"),
    fetch,
  };
}
