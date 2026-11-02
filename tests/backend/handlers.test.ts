import { describe, expect, it } from "vitest";
import { listTorrents, testConnection } from "../../src/backend/handlers.js";
import { TorrentService } from "../../src/backend/service.js";
import type { FetchLike } from "../../src/backend/qbittorrent/client.js";

const ok: FetchLike = async (url) =>
  new Response(url.endsWith("/app/webapiVersion") ? "2.15.1" : "v5.3.0", {
    status: 200,
  });

describe("testConnection", () => {
  it("asks for a URL before anything else", async () => {
    const res = await testConnection({
      getBaseUrl: () => "",
      getApiKey: () => "k",
      fetch: ok,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      error: {
        kind: "not-configured",
        message: "Set the qBittorrent URL in the plugin settings first.",
      },
    });
  });

  it("asks for a key when only the URL is set", async () => {
    const res = await testConnection({
      getBaseUrl: () => "http://q:8080",
      getApiKey: async () => undefined,
      fetch: ok,
    });
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).toContain("API key");
  });

  it("reports versions on success", async () => {
    const res = await testConnection({
      getBaseUrl: () => "http://q:8080",
      getApiKey: () => "k",
      fetch: ok,
    });
    expect(res.body).toEqual({
      ok: true,
      appVersion: "v5.3.0",
      webApiVersion: "2.15.1",
    });
  });

  it("reports a connection failure in the body and never leaks the key", async () => {
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      });
    };
    const res = await testConnection({
      getBaseUrl: () => "http://q:8080",
      getApiKey: () => "qbt_secret",
      fetch: down,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).toContain("ENOTFOUND");
    expect(JSON.stringify(res.body)).not.toContain("qbt_secret");
  });
});

describe("listTorrents", () => {
  const maindata: FetchLike = async () =>
    new Response(
      JSON.stringify({
        rid: 1,
        full_update: true,
        torrents: {
          aaa: { name: "debian.iso", state: "downloading", progress: 0.5 },
        },
        server_state: { dl_info_speed: 1234, connection_status: "connected" },
      }),
      { status: 200 },
    );

  it("returns the snapshot on success", async () => {
    const res = await listTorrents(
      {
        getBaseUrl: () => "http://q:8080",
        getApiKey: () => "k",
        fetch: maindata,
      },
      new TorrentService(),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.ok) {
      expect(res.body.torrents.map((t) => t.name)).toEqual(["debian.iso"]);
      expect(res.body.serverState.downloadSpeed).toBe(1234);
    }
  });

  it("asks for configuration without calling out", async () => {
    let called = false;
    const spy: FetchLike = async (...args) => {
      called = true;
      return maindata(...args);
    };
    const res = await listTorrents(
      { getBaseUrl: () => "", getApiKey: () => "k", fetch: spy },
      new TorrentService(),
    );
    expect(JSON.stringify(res.body)).toContain("not-configured");
    expect(called).toBe(false);
  });

  it("reports an unreachable qBittorrent in the body, with 200", async () => {
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    };
    const res = await listTorrents(
      {
        getBaseUrl: () => "http://q:8080",
        getApiKey: () => "qbt_secret",
        fetch: down,
      },
      new TorrentService(),
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).toContain("ECONNREFUSED");
    expect(JSON.stringify(res.body)).not.toContain("qbt_secret");
  });

  it("reports a bad URL setting as an error body, not a crash", async () => {
    const res = await listTorrents(
      {
        getBaseUrl: () => "qbittorrent:8080",
        getApiKey: () => "k",
        fetch: maindata,
      },
      new TorrentService(),
    );
    expect(JSON.stringify(res.body)).toContain("invalid-url");
  });
});
