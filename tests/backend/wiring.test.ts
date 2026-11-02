import { describe, expect, it } from "vitest";
import { connectionDeps } from "../../src/backend/connection.js";
import { registerRoutes } from "../../src/backend/routes.js";
import { TorrentService } from "../../src/backend/service.js";
import { validateAdminSettings } from "../../src/backend/settings.js";

interface Recorded {
  url: string;
  init?: Record<string, unknown>;
}

/** A plain-object stand-in for the parts of PluginContext the wiring touches. */
function fakeCtx(
  settings: Record<string, string | undefined>,
  respond?: (url: string) => Response,
) {
  const recorded: Recorded[] = [];
  const ctx = {
    // Uses `this` on purpose: the real ctx.fetch must be called as a method.
    marker: "bound",
    async fetch(
      this: { marker?: string },
      url: string,
      init?: Record<string, unknown>,
    ) {
      if (this?.marker !== "bound") throw new Error("ctx.fetch lost its this");
      recorded.push({ url, init });
      return (
        respond?.(url) ??
        new Response(
          url.includes("/sync/maindata")
            ? JSON.stringify({
                rid: 1,
                full_update: true,
                torrents: { aaa: { name: "debian.iso" } },
              })
            : url.endsWith("/app/webapiVersion")
              ? "2.15.1"
              : "v5.3.0",
          { status: 200 },
        )
      );
    },
    settings: {
      async get(key: string) {
        return settings[key];
      },
    },
    rbac: { require: (name: string) => ({ requires: name }) },
  };
  return { ctx, recorded };
}

describe("connectionDeps", () => {
  it("reads the URL and the API key from settings", async () => {
    const { ctx } = fakeCtx({
      baseUrl: "http://qbittorrent:8080",
      apiKey: "qbt_secret",
    });
    const deps = connectionDeps(ctx as never);
    expect(await deps.getBaseUrl()).toBe("http://qbittorrent:8080");
    expect(await deps.getApiKey()).toBe("qbt_secret");
  });

  it("allows exactly the configured host through the private-address guard", async () => {
    const { ctx, recorded } = fakeCtx({});
    const deps = connectionDeps(ctx as never);
    await deps.fetch!("http://qbittorrent:8080/api/v2/app/version", {
      method: "GET",
    });
    expect(recorded[0].init?.allowPrivateHosts).toEqual(["qbittorrent"]);
    expect(recorded[0].init?.method).toBe("GET");
  });
});

describe("registerRoutes", () => {
  function register(settings: Record<string, string | undefined>) {
    const used: unknown[] = [];
    const posts: Record<string, unknown[]> = {};
    const gets: Record<string, unknown[]> = {};
    const router = {
      use: (...args: unknown[]) => used.push(...args),
      post: (path: string, ...handlers: unknown[]) => (posts[path] = handlers),
      get: (path: string, ...handlers: unknown[]) => (gets[path] = handlers),
    };
    const { ctx, recorded } = fakeCtx(settings);
    registerRoutes(router as never, ctx as never, new TorrentService());
    return { used, posts, gets, recorded };
  }

  async function call(handler: unknown) {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    await (handler as (req: unknown, res: unknown) => Promise<void>)({}, res);
    return res;
  }

  it("gates the router on view and test-connection on manage", () => {
    const { used, posts } = register({});
    expect(used[0]).toEqual({ requires: "view" });
    expect(posts["/test-connection"][0]).toEqual({ requires: "manage" });
  });

  it("answers test-connection with the versions", async () => {
    const { posts, recorded } = register({
      baseUrl: "http://qbittorrent:8080",
      apiKey: "qbt_secret",
    });
    const res = await call(posts["/test-connection"].at(-1));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      appVersion: "v5.3.0",
      webApiVersion: "2.15.1",
    });
    expect(recorded.length).toBe(2);
  });

  it("serves GET /torrents under the router-level view gate", async () => {
    const { used, gets, recorded } = register({
      baseUrl: "http://qbittorrent:8080",
      apiKey: "qbt_secret",
    });
    expect(used[0]).toEqual({ requires: "view" });
    expect(gets["/torrents"].length).toBe(1); // no extra permission beyond view

    const res = await call(gets["/torrents"].at(-1));
    expect(res.statusCode).toBe(200);
    const body = res.body as { ok: boolean; torrents: Array<{ name: string }> };
    expect(body.ok).toBe(true);
    expect(body.torrents.map((t) => t.name)).toEqual(["debian.iso"]);
    expect(recorded[0].url).toBe(
      "http://qbittorrent:8080/api/v2/sync/maindata?rid=0",
    );
    expect(recorded[0].init?.allowPrivateHosts).toEqual(["qbittorrent"]);
  });

  it("answers test-connection with not-configured, without calling out", async () => {
    const { posts, recorded } = register({});
    const res = await call(posts["/test-connection"].at(-1));
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain("not-configured");
    expect(recorded.length).toBe(0);
  });
});

describe("validateAdminSettings", () => {
  it("accepts an empty URL so the plugin can be installed first", () => {
    expect(validateAdminSettings({ baseUrl: "" })).toEqual({});
    expect(validateAdminSettings({})).toEqual({});
  });

  it("accepts a valid URL", () => {
    expect(
      validateAdminSettings({ baseUrl: "http://qbittorrent:8080" }),
    ).toEqual({});
  });

  it("rejects a bad URL with a message on the baseUrl field", () => {
    const result = validateAdminSettings({ baseUrl: "qbittorrent:8080" });
    expect(Object.keys(result)).toEqual(["baseUrl"]);
    expect(result.baseUrl).toContain("http://");
  });
});
