import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import express, { type Router } from "express";
import {
  createMockCtx,
  createTestDb,
  type MockPluginContext,
  type TestDb,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import manifestJson from "../../manifest.json";
import { activate } from "../../src/backend/index.js";

const pluginDir = fileURLToPath(new URL("../..", import.meta.url));
const manifest = manifestJson as unknown as PluginManifest;
const HASH = "a".repeat(40);

let db: TestDb;
let mock: MockPluginContext;
let server: http.Server;
let port: number;

async function start(permissions: string[]) {
  db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("user-1", "user-1");

  let router: Router | null = null;
  mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
    router: () => (router = express.Router()),
    permissions,
    fetch: async (url) =>
      new Response(
        url.includes("/torrents/add") ? '{"success_count":1}' : "[]",
        {
          status: 200,
        },
      ),
  });
  await mock.ctx.settings.set("baseUrl", "http://qbittorrent:8080");
  await mock.ctx.settings.set("apiKey", "qbt_secret");
  await activate(mock.ctx);

  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    mock.setActor("user-1");
    next();
  });
  app.use((req, res, next) => router!(req, res, next));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const ROUTES: {
  method: string;
  path: string;
  body?: unknown;
  needs: string;
}[] = [
  { method: "GET", path: "/torrents", needs: "view" },
  { method: "GET", path: `/torrents/${HASH}/details`, needs: "view" },
  { method: "GET", path: "/location-config", needs: "view" },
  {
    method: "POST",
    path: "/torrents/add",
    body: { urls: ["magnet:?xt=urn:btih:abc"] },
    needs: "manage",
  },
  {
    method: "POST",
    path: "/torrents/actions",
    body: { action: "stop", hashes: [HASH] },
    needs: "manage",
  },
  {
    method: "POST",
    path: "/torrents/delete",
    body: { hashes: [HASH], deleteFiles: false },
    needs: "delete",
  },
  { method: "POST", path: "/test-connection", needs: "manage" },
];

describe("permissions", () => {
  for (const route of ROUTES) {
    const name = `${route.method} ${route.path}`;

    it(`${name} is allowed with ${route.needs}`, async () => {
      await start(["qbittorrent.view", `qbittorrent.${route.needs}`]);
      const res = await request(route.method, route.path, route.body);
      expect(res.status).toBe(200);
    });

    it(`${name} is refused without ${route.needs}`, async () => {
      const others = ["view", "manage", "delete"].filter(
        (p) => p !== route.needs,
      );
      await start(others.map((p) => `qbittorrent.${p}`));
      const res = await request(route.method, route.path, route.body);
      expect(res.status).toBe(403);
    });
  }

  it("does not let manage delete", async () => {
    await start(["qbittorrent.view", "qbittorrent.manage"]);
    const res = await request("POST", "/torrents/delete", {
      hashes: [HASH],
      deleteFiles: true,
    });
    expect(res.status).toBe(403);
    expect(mock.fetches.length).toBe(0);
  });
});

describe("/location-config", () => {
  it("returns the mapping", async () => {
    await start(["qbittorrent.view"]);
    await mock.ctx.settings.set("fileHostId", "7");
    await mock.ctx.settings.set("qbtPathPrefix", " /downloads ");
    await mock.ctx.settings.set("hostPathPrefix", "/mnt/media");
    const res = await request("GET", "/location-config");
    expect(res.body).toEqual({
      ok: true,
      hostId: "7",
      qbtPrefix: "/downloads",
      hostPrefix: "/mnt/media",
    });
  });

  it("reports no host when unset", async () => {
    await start(["qbittorrent.view"]);
    const res = await request("GET", "/location-config");
    expect(res.body).toMatchObject({ hostId: null, qbtPrefix: "" });
  });
});
