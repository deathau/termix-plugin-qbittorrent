import { describe, expect, it } from "vitest";
import {
  addTorrents,
  deleteTorrents,
  runTorrentAction,
  torrentDetails,
  type ConnectionDeps,
} from "../../src/backend/handlers.js";
import {
  QbtClient,
  QbtError,
  type FetchLike,
} from "../../src/backend/qbittorrent/client.js";
import { TorrentService } from "../../src/backend/service.js";
import { validateAdminSettings } from "../../src/backend/settings.js";

const A = "a".repeat(40);
const B = "b".repeat(64);

interface Call {
  url: string;
  init: RequestInit;
}

function fake(respond: (url: string) => Response = () => new Response("")) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    return respond(url);
  };
  const deps: ConnectionDeps = {
    getBaseUrl: () => "http://q:8080",
    getApiKey: () => "k",
    fetch,
  };
  return {
    calls,
    fetch,
    deps,
    client: new QbtClient({
      ...deps,
      baseUrl: "http://q:8080",
      apiKey: "k",
      fetch,
    }),
  };
}

function form(call: Call): URLSearchParams {
  return new URLSearchParams(call.init.body as string);
}

async function failure(promise: Promise<unknown>): Promise<QbtError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof QbtError) return err;
    throw err;
  }
  throw new Error("expected a QbtError");
}

describe("QbtClient.torrentAction", () => {
  it("posts urlencoded, pipe-separated hashes with the key", async () => {
    const { client, calls } = fake();
    await client.torrentAction("stop", [A, B]);
    expect(calls[0].url).toBe("http://q:8080/api/v2/torrents/stop");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer k",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(form(calls[0]).get("hashes")).toBe(`${A}|${B}`);
    expect(form(calls[0]).has("value")).toBe(false);
  });

  it("sends value for force start, defaulting to true", async () => {
    const { client, calls } = fake();
    await client.torrentAction("setForceStart", [A]);
    await client.torrentAction("setForceStart", [A], false);
    expect(form(calls[0]).get("value")).toBe("true");
    expect(form(calls[1]).get("value")).toBe("false");
  });

  it("explains a 409 from a queue move", async () => {
    const { client } = fake(() => new Response("", { status: 409 }));
    const err = await failure(client.torrentAction("topPrio", [A]));
    expect(err.kind).toBe("conflict");
    expect(err.message).toContain("queueing is turned off");
  });
});

describe("QbtClient.addTorrents", () => {
  const urls = ["magnet:?xt=urn:btih:abc&dn=a b", "https://x/y.torrent"];

  it("sends newline-separated links and only the options given", async () => {
    const { client, calls } = fake(() => new Response("{}"));
    await client.addTorrents({ urls });
    const sent = form(calls[0]);
    expect(sent.get("urls")).toBe(urls.join("\n"));
    expect([...sent.keys()]).toEqual(["urls"]);
  });

  it("maps every option, using stopped rather than paused", async () => {
    const { client, calls } = fake(() => new Response("{}"));
    await client.addTorrents({
      urls,
      savePath: "/dl",
      category: "linux",
      tags: ["a", "b"],
      stopped: true,
    });
    const sent = form(calls[0]);
    expect(sent.get("savepath")).toBe("/dl");
    expect(sent.get("category")).toBe("linux");
    expect(sent.get("tags")).toBe("a,b");
    expect(sent.get("stopped")).toBe("true");
    expect(sent.has("paused")).toBe(false);
  });

  it("reads the JSON counts on 200 and 202", async () => {
    const json = JSON.stringify({
      success_count: 1,
      failure_count: 1,
      pending_count: 2,
      added_torrent_ids: [A],
    });
    for (const status of [200, 202]) {
      const { client } = fake(() => new Response(json, { status }));
      expect(await client.addTorrents({ urls })).toEqual({
        added: 1,
        failed: 1,
        pending: 2,
      });
    }
  });

  it("accepts the plain text answers of older versions", async () => {
    const ok = fake(() => new Response("Ok."));
    expect(await ok.client.addTorrents({ urls })).toEqual({
      added: 2,
      failed: 0,
      pending: 0,
    });
    const fails = fake(() => new Response("Fails."));
    expect(await fails.client.addTorrents({ urls })).toEqual({
      added: 0,
      failed: 2,
      pending: 0,
    });
  });

  it("says a 409 may mean a duplicate", async () => {
    const { client } = fake(() => new Response("", { status: 409 }));
    const err = await failure(client.addTorrents({ urls }));
    expect(err.kind).toBe("conflict");
    expect(err.message).toContain("invalid");
    expect(err.message).toContain("already");
  });

  it("reports a 400 and a 415 as bad requests", async () => {
    for (const status of [400, 415]) {
      const { client } = fake(() => new Response("", { status }));
      expect((await failure(client.addTorrents({ urls }))).kind).toBe(
        "bad-request",
      );
    }
  });
});

describe("QbtClient.deleteTorrents", () => {
  it("passes deleteFiles through exactly", async () => {
    const { client, calls } = fake();
    await client.deleteTorrents([A], false);
    await client.deleteTorrents([A], true);
    expect(calls[0].url).toContain("/torrents/delete");
    expect(form(calls[0]).get("deleteFiles")).toBe("false");
    expect(form(calls[1]).get("deleteFiles")).toBe("true");
  });
});

describe("runTorrentAction", () => {
  it("runs an action and refreshes the next list request", async () => {
    let now = 0;
    const service = new TorrentService({ now: () => now });
    const { deps, calls, client } = fake((url) =>
      url.includes("maindata")
        ? new Response('{"rid":1,"full_update":true}')
        : new Response(""),
    );
    await service.snapshot(client);
    await service.snapshot(client); // served from the cache
    expect(calls.length).toBe(1);

    const res = await runTorrentAction(deps, service, {
      action: "start",
      hashes: [A],
    });
    expect(res.body).toEqual({ ok: true });

    await service.snapshot(client);
    expect(calls.filter((c) => c.url.includes("maindata")).length).toBe(2);
  });

  it("refuses bad input without calling qBittorrent", async () => {
    const { deps, calls } = fake();
    const service = new TorrentService();
    for (const input of [
      undefined,
      {},
      { action: "start" },
      { action: "start", hashes: [] },
      { action: "start", hashes: "all" },
      { action: "start", hashes: ["all"] },
      { action: "start", hashes: [`${A}|${A}`] },
      { action: "delete", hashes: [A] },
      { action: "../app/shutdown", hashes: [A] },
      { action: "setForceStart", hashes: [A], value: "yes" },
    ]) {
      const res = await runTorrentAction(deps, service, input);
      expect(res.status).toBe(400);
    }
    expect(calls.length).toBe(0);
  });

  it("reports qBittorrent's refusal as ok false with a 200", async () => {
    const { deps } = fake(() => new Response("", { status: 409 }));
    const res = await runTorrentAction(deps, new TorrentService(), {
      action: "topPrio",
      hashes: [A],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });
});

describe("deleteTorrents", () => {
  it("requires an explicit deleteFiles", async () => {
    const { deps, calls } = fake();
    const res = await deleteTorrents(deps, new TorrentService(), {
      hashes: [A],
    });
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("deletes", async () => {
    const { deps, calls } = fake();
    const res = await deleteTorrents(deps, new TorrentService(), {
      hashes: [A],
      deleteFiles: false,
    });
    expect(res.body).toEqual({ ok: true });
    expect(calls.length).toBe(1);
  });
});

describe("addTorrents", () => {
  it("adds and returns the counts", async () => {
    const { deps } = fake(() => new Response('{"success_count":1}'));
    const res = await addTorrents(deps, new TorrentService(), {
      urls: ["magnet:?xt=urn:btih:abc"],
    });
    expect(res.body).toEqual({ ok: true, added: 1, failed: 0, pending: 0 });
  });

  it("refuses anything but links", async () => {
    const { deps, calls } = fake();
    const service = new TorrentService();
    for (const input of [
      undefined,
      { urls: [] },
      { urls: "magnet:?a" },
      { urls: ["file:///etc/passwd"] },
      { urls: ["/etc/passwd"] },
      { urls: ["magnet:?a\nhttp://b"] },
      { urls: Array(101).fill("magnet:?a") },
      { urls: ["magnet:?a"], tags: "a" },
      { urls: ["magnet:?a"], savePath: 1 },
      { urls: ["magnet:?a"], stopped: "true" },
    ]) {
      expect((await addTorrents(deps, service, input)).status).toBe(400);
    }
    expect(calls.length).toBe(0);
  });
});

describe("torrentDetails", () => {
  it("combines properties, files and trackers", async () => {
    const { deps, calls } = fake(
      (url) =>
        new Response(
          url.includes("/properties")
            ? '{"save_path":"/dl"}'
            : url.includes("/files")
              ? '[{"index":0,"name":"a"}]'
              : '[{"url":"http://t"}]',
        ),
    );
    const res = await torrentDetails(deps, A);
    expect(res.body).toEqual({
      ok: true,
      properties: { save_path: "/dl" },
      files: [{ index: 0, name: "a" }],
      trackers: [{ url: "http://t" }],
    });
    expect(calls.every((c) => c.url.endsWith(`hash=${A}`))).toBe(true);
  });

  it("refuses a malformed hash before calling out", async () => {
    const { deps, calls } = fake();
    const res = await torrentDetails(deps, "../../app/shutdown");
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("reports a missing torrent", async () => {
    const { deps } = fake(() => new Response("", { status: 404 }));
    const res = await torrentDetails(deps, A);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, error: { kind: "not-found" } });
  });

  it("does not trust a 200 that isn't JSON", async () => {
    const { deps } = fake(() => new Response("<html>"));
    const res = await torrentDetails(deps, A);
    expect(res.body).toMatchObject({
      ok: false,
      error: { kind: "unexpected" },
    });
  });
});

describe("validateAdminSettings path prefixes", () => {
  it("accepts both or neither", () => {
    expect(validateAdminSettings({})).toEqual({});
    expect(
      validateAdminSettings({ qbtPathPrefix: "/dl", hostPathPrefix: "/mnt" }),
    ).toEqual({});
    expect(
      validateAdminSettings({
        qbtPathPrefix: "D:\\dl",
        hostPathPrefix: "/mnt",
      }),
    ).toEqual({});
  });

  it("needs the pair", () => {
    expect(
      Object.keys(validateAdminSettings({ qbtPathPrefix: "/dl" })),
    ).toEqual(["hostPathPrefix"]);
    expect(
      Object.keys(validateAdminSettings({ hostPathPrefix: "/mnt" })),
    ).toEqual(["qbtPathPrefix"]);
  });

  it("needs absolute paths", () => {
    expect(
      Object.keys(
        validateAdminSettings({ qbtPathPrefix: "dl", hostPathPrefix: "mnt" }),
      ).sort(),
    ).toEqual(["hostPathPrefix", "qbtPathPrefix"]);
  });
});
