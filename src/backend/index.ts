import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerRoutes } from "./routes.js";
import { TorrentService } from "./service.js";
import { validateAdminSettings } from "./settings.js";

export async function activate(ctx: PluginContext) {
  const service = new TorrentService();
  // A new URL or key means a different qBittorrent: drop the cached state.
  ctx.settings.onChange(() => service.reset());
  ctx.settings.onValidate("admin", validateAdminSettings);
  registerRoutes(ctx.http.router(), ctx, service);
}
