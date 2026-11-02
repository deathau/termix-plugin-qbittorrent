/**
 * The only place that touches the SDK's settings and outbound fetch, so
 * handlers.ts and the client stay testable without Termix.
 */
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import type { ConnectionDeps } from "./handlers.js";
import type { FetchLike } from "./qbittorrent/client.js";
import { toLocationConfig, type LocationConfig } from "./settings.js";

type OutboundInit = Parameters<PluginContext["fetch"]>[1];

export function connectionDeps(ctx: PluginContext): ConnectionDeps {
  // The URL is set by an admin and users cannot change it, so allowing exactly
  // that host does not open an SSRF path for other users. Calling through
  // `ctx.fetch(...)` keeps `this` bound.
  const fetch: FetchLike = (input, init) =>
    ctx.fetch(input, {
      ...(init as OutboundInit),
      allowPrivateHosts: [new URL(input).hostname],
    });

  return {
    getBaseUrl: () => ctx.settings.get<string>("baseUrl"),
    getApiKey: () => ctx.settings.get<string>("apiKey"),
    fetch,
  };
}

export async function locationConfig(
  ctx: PluginContext,
): Promise<LocationConfig> {
  const [fileHostId, qbtPathPrefix, hostPathPrefix] = await Promise.all([
    ctx.settings.get("fileHostId"),
    ctx.settings.get("qbtPathPrefix"),
    ctx.settings.get("hostPathPrefix"),
  ]);
  return toLocationConfig({ fileHostId, qbtPathPrefix, hostPathPrefix });
}
