import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { connectionDeps } from "./connection.js";
import { listTorrents, testConnection } from "./handlers.js";
import type { TorrentService } from "./service.js";

export function registerRoutes(
  router: Router,
  ctx: PluginContext,
  service: TorrentService,
): void {
  router.use(ctx.rbac.require("view") as never);

  /**
   * @openapi
   * /plugin-api/qbittorrent/torrents:
   *   get:
   *     summary: List torrents with the global transfer state
   *     description: >
   *       Always answers 200. When qBittorrent can't be reached the body has
   *       ok false with an error kind and message. Refreshes from qBittorrent
   *       at most about once every 1.5 seconds, however many viewers there are.
   *     tags:
   *       - qBittorrent
   *     responses:
   *       200:
   *         description: ok true with torrents, serverState, categories, tags and sync, or ok false with an error
   */
  router.get("/torrents", async (_req: Request, res: Response) => {
    const result = await listTorrents(connectionDeps(ctx), service);
    res.status(result.status).json(result.body);
  });

  /**
   * @openapi
   * /plugin-api/qbittorrent/test-connection:
   *   post:
   *     summary: Check the configured qBittorrent URL and API key
   *     description: >
   *       Always answers 200. Whether qBittorrent was reachable, and why not,
   *       is in the body.
   *     tags:
   *       - qBittorrent
   *     responses:
   *       200:
   *         description: ok true with the qBittorrent and WebAPI versions, or ok false with an error kind and message
   */
  router.post(
    "/test-connection",
    ctx.rbac.require("manage") as never,
    async (_req: Request, res: Response) => {
      const result = await testConnection(connectionDeps(ctx));
      res.status(result.status).json(result.body);
    },
  );
}
