import { describe, expect, it } from "vitest";
import {
  MIN_WEBAPI_VERSION,
  QbtClient,
  QbtError,
  compareVersions,
  normalizeBaseUrl,
  type FetchLike,
} from "../../src/backend/qbittorrent/client.js";

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond(url);
  };
  return { fetch, calls };
}

const text = (body: string, status = 200) => new Response(body, { status });

async function caught(promise: Promise<unknown>): Promise<QbtError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof QbtError) return err;
    throw err;
  }
  throw new Error("expected the promise to reject with a QbtError");
}

describe("normalizeBaseUrl", () => {
  it("strips trailing slashes, query and hash but keeps a path prefix", () => {
    expect(normalizeBaseUrl(" http://qbittorrent:8080/ ")).toBe(
      "http://qbittorrent:8080",
    );
    expect(normalizeBaseUrl("https://example.com/qbt///?x=1#y")).toBe(
      "https://example.com/qbt",
    );
  });

  it("rejects junk, non-http schemes and embedded credentials", () => {
    for (const bad of [
      "",
      "qbittorrent:8080",
      "ftp://host",
      "http://user:pw@host:8080",
    ]) {
      let kind = "";
      try {
        normalizeBaseUrl(bad);
      } catch (err) {
        kind = err instanceof QbtError ? err.kind : "other";
      }
      expect(kind).toBe("invalid-url");
    }
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("2.15.1", "2.9.0") > 0).toBe(true);
    expect(compareVersions("2.11", "2.11.0")).toBe(0);
    expect(compareVersions("2.10.9", MIN_WEBAPI_VERSION) < 0).toBe(true);
  });
});

describe("QbtClient", () => {
  it("requires an API key", () => {
    let kind = "";
    try {
      new QbtClient({ baseUrl: "http://qbittorrent:8080", apiKey: "   " });
    } catch (err) {
      kind = err instanceof QbtError ? err.kind : "other";
    }
    expect(kind).toBe("missing-key");
  });

  it("sends the key as a Bearer token and returns both versions", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      url.endsWith("/app/webapiVersion") ? text("2.15.1\n") : text("v5.3.0"),
    );
    const client = new QbtClient({
      baseUrl: "http://qbittorrent:8080/",
      apiKey: "qbt_secret",
      fetch,
    });

    const info = await client.testConnection();

    expect(info).toEqual({ appVersion: "v5.3.0", webApiVersion: "2.15.1" });
    expect(calls[0].url).toBe(
      "http://qbittorrent:8080/api/v2/app/webapiVersion",
    );
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer qbt_secret");
  });

  it("keeps the key out of its own serialized form", () => {
    const client = new QbtClient({
      baseUrl: "http://qbittorrent:8080",
      apiKey: "qbt_secret",
    });
    expect(JSON.stringify(client)).not.toContain("qbt_secret");
  });

  it("explains a 403 as a bad key or a pre-5.2 server", async () => {
    const { fetch } = fakeFetch(() => text("Forbidden", 403));
    const client = new QbtClient({
      baseUrl: "http://q:8080",
      apiKey: "k",
      fetch,
    });

    const err = await caught(client.testConnection());

    expect(err.kind).toBe("forbidden");
    expect(err.status).toBe(403);
    expect(err.message).toContain("5.2");
  });

  it("reports other HTTP failures", async () => {
    const { fetch } = fakeFetch(() => text("boom", 502));
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("http");
    expect(err.status).toBe(502);
  });

  it("explains a redirect instead of following it", async () => {
    const { fetch, calls } = fakeFetch(
      () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://q.example.com/" },
        }),
    );
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q.example.com",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("redirect");
    expect(err.message).toContain("https://q.example.com/");
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("turns connection failures into a network error naming the cause", async () => {
    const fetch: FetchLike = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    };
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("network");
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.message).toContain("http://q:8080");
  });

  it("turns a timeout into a timeout error", async () => {
    const fetch: FetchLike = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("10s");
  });

  it("words a sub-second timeout in milliseconds", async () => {
    const fetch: FetchLike = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    const client = new QbtClient({
      baseUrl: "http://q:8080",
      apiKey: "k",
      fetch,
      timeoutMs: 300,
    });
    expect((await caught(client.testConnection())).message).toContain("300ms");
  });

  it("does not mistake an HTML 200 for qBittorrent", async () => {
    const { fetch } = fakeFetch(() => text("<html>Sign in</html>"));
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("unexpected");
  });

  it("rejects a WebAPI older than the stop/start rename", async () => {
    const { fetch } = fakeFetch(() => text("2.9.3"));
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).testConnection(),
    );
    expect(err.kind).toBe("unsupported");
  });
});

describe("QbtClient.getMainData", () => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  it("requests the given rid and returns the parsed reply", async () => {
    const reply = { rid: 15, torrents: { abc: { state: "stoppedUP" } } };
    const { fetch, calls } = fakeFetch(() => json(reply));
    const client = new QbtClient({
      baseUrl: "http://q:8080",
      apiKey: "k",
      fetch,
    });

    expect(await client.getMainData(14)).toEqual(reply);
    expect(calls[0].url).toBe("http://q:8080/api/v2/sync/maindata?rid=14");
  });

  it("sends a safe rid for junk input", async () => {
    const { fetch, calls } = fakeFetch(() => json({ rid: 1 }));
    const client = new QbtClient({
      baseUrl: "http://q:8080",
      apiKey: "k",
      fetch,
    });
    await client.getMainData(-5);
    await client.getMainData(Number.NaN);
    await client.getMainData(3.9);
    expect(calls.map((c) => c.url.split("?")[1])).toEqual([
      "rid=0",
      "rid=0",
      "rid=3",
    ]);
  });

  it("does not mistake an HTML page or a JSON object without a rid for qBittorrent", async () => {
    for (const body of ["<html>Sign in</html>", '{"hello":"world"}', "null"]) {
      const { fetch } = fakeFetch(() => text(body));
      const err = await caught(
        new QbtClient({
          baseUrl: "http://q:8080",
          apiKey: "k",
          fetch,
        }).getMainData(0),
      );
      expect(err.kind).toBe("unexpected");
    }
  });

  it("surfaces a 403 like every other call", async () => {
    const { fetch } = fakeFetch(() => text("Forbidden", 403));
    const err = await caught(
      new QbtClient({
        baseUrl: "http://q:8080",
        apiKey: "k",
        fetch,
      }).getMainData(0),
    );
    expect(err.kind).toBe("forbidden");
  });
});
