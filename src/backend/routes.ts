import type { Request, Response, Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { connectionDeps, locationConfig } from "./connection.js";
import {
  addTorrents,
  deleteTorrents,
  listTorrents,
  runTorrentAction,
  testConnection,
  torrentDetails,
} from "./handlers.js";
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
   * /plugin-api/qbittorrent/torrents/{hash}/details:
   *   get:
   *     summary: Get a torrent's properties, files and trackers
   *     description: >
   *       Answers 400 for a malformed hash. Otherwise always answers 200; when
   *       qBittorrent can't answer, the body has ok false with an error.
   *     tags:
   *       - qBittorrent
   *     parameters:
   *       - in: path
   *         name: hash
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: ok true with properties, files and trackers, or ok false with an error
   *       400:
   *         description: The hash is malformed
   */
  router.get("/torrents/:hash/details", async (req: Request, res: Response) => {
    const result = await torrentDetails(
      connectionDeps(ctx),
      String(req.params.hash),
    );
    res.status(result.status).json(result.body);
  });

  /**
   * @openapi
   * /plugin-api/qbittorrent/location-config:
   *   get:
   *     summary: Get the Termix host and path mapping for opening torrent locations
   *     tags:
   *       - qBittorrent
   *     responses:
   *       200:
   *         description: ok true with hostId, qbtPrefix and hostPrefix
   */
  router.get("/location-config", async (_req: Request, res: Response) => {
    res.json({ ok: true, ...(await locationConfig(ctx)) });
  });

  /**
   * @openapi
   * /plugin-api/qbittorrent/torrents/add:
   *   post:
   *     summary: Add torrents from magnet links or URLs
   *     description: >
   *       Answers 400 for invalid input. Otherwise always answers 200; when
   *       nothing was added, the body has ok false with an error.
   *     tags:
   *       - qBittorrent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [urls]
   *             properties:
   *               urls:
   *                 type: array
   *                 items:
   *                   type: string
   *               savePath:
   *                 type: string
   *               category:
   *                 type: string
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *               stopped:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: ok true with added, failed and pending counts, or ok false with an error
   *       400:
   *         description: The input is invalid
   */
  router.post(
    "/torrents/add",
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const result = await addTorrents(connectionDeps(ctx), service, req.body);
      res.status(result.status).json(result.body);
    },
  );

  /**
   * @openapi
   * /plugin-api/qbittorrent/torrents/actions:
   *   post:
   *     summary: Start, stop, recheck, reannounce, force start or move torrents in the queue
   *     description: >
   *       Answers 400 for invalid input. Otherwise always answers 200; when
   *       qBittorrent refuses, the body has ok false with an error.
   *     tags:
   *       - qBittorrent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [action, hashes]
   *             properties:
   *               action:
   *                 type: string
   *                 enum: [start, stop, recheck, reannounce, increasePrio, decreasePrio, topPrio, bottomPrio, setForceStart]
   *               hashes:
   *                 type: array
   *                 items:
   *                   type: string
   *               value:
   *                 type: boolean
   *                 description: For setForceStart. Defaults to true.
   *     responses:
   *       200:
   *         description: ok true, or ok false with an error
   *       400:
   *         description: The input is invalid
   */
  router.post(
    "/torrents/actions",
    ctx.rbac.require("manage") as never,
    async (req: Request, res: Response) => {
      const result = await runTorrentAction(
        connectionDeps(ctx),
        service,
        req.body,
      );
      res.status(result.status).json(result.body);
    },
  );

  /**
   * @openapi
   * /plugin-api/qbittorrent/torrents/delete:
   *   post:
   *     summary: Remove torrents, optionally with their downloaded files
   *     description: >
   *       Answers 400 for invalid input. Otherwise always answers 200; when
   *       qBittorrent can't be reached, the body has ok false with an error.
   *     tags:
   *       - qBittorrent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [hashes, deleteFiles]
   *             properties:
   *               hashes:
   *                 type: array
   *                 items:
   *                   type: string
   *               deleteFiles:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: ok true, or ok false with an error
   *       400:
   *         description: The input is invalid
   */
  router.post(
    "/torrents/delete",
    ctx.rbac.require("delete") as never,
    async (req: Request, res: Response) => {
      const result = await deleteTorrents(
        connectionDeps(ctx),
        service,
        req.body,
      );
      res.status(result.status).json(result.body);
    },
  );

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
