import { describe, expect, it } from "vitest";
import {
  QbtError,
  type MainDataUpdate,
  type QbtClient,
} from "../../src/backend/qbittorrent/client.js";
import { TorrentService } from "../../src/backend/service.js";

/** A client double whose getMainData is scripted and records the rids it was asked for. */
function fakeClient(replies: Array<MainDataUpdate | Error>) {
  const rids: number[] = [];
  let i = 0;
  const client = {
    async getMainData(rid: number) {
      rids.push(rid);
      const next = replies[Math.min(i++, replies.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client: client as unknown as QbtClient, rids };
}

/** A promise you resolve by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

const names = (s: { torrents: Array<{ name: string }> }) =>
  s.torrents.map((t) => t.name);

describe("TorrentService", () => {
  it("starts with rid 0 and passes each reply\u2019s rid to the next request", async () => {
    let t = 0;
    const service = new TorrentService({ minIntervalMs: 1000, now: () => t });
    const { client, rids } = fakeClient([
      { rid: 5, full_update: true, torrents: { a: { name: "one" } } },
      { rid: 6, torrents: { a: { name: "one-renamed" } } },
    ]);

    expect(names(await service.snapshot(client))).toEqual(["one"]);
    t = 2000;
    expect(names(await service.snapshot(client))).toEqual(["one-renamed"]);
    expect(rids).toEqual([0, 5]);
  });

  it("serves the cached snapshot to requests inside the minimum interval", async () => {
    let t = 0;
    const service = new TorrentService({ minIntervalMs: 1000, now: () => t });
    const { client, rids } = fakeClient([
      { rid: 1, full_update: true, torrents: { a: { name: "one" } } },
    ]);

    await service.snapshot(client);
    t = 500;
    await service.snapshot(client);
    expect(rids.length).toBe(1);
    t = 1000;
    await service.snapshot(client);
    expect(rids.length).toBe(2);
  });

  it("shares one upstream request between concurrent viewers", async () => {
    const service = new TorrentService({ minIntervalMs: 1000, now: () => 0 });
    const gate = deferred<MainDataUpdate>();
    let calls = 0;
    const client = {
      async getMainData() {
        calls++;
        return gate.promise;
      },
    } as unknown as QbtClient;

    const pending = [
      service.snapshot(client),
      service.snapshot(client),
      service.snapshot(client),
    ];
    gate.resolve({
      rid: 1,
      full_update: true,
      torrents: { a: { name: "one" } },
    });
    const results = await Promise.all(pending);

    expect(calls).toBe(1);
    for (const r of results) expect(names(r)).toEqual(["one"]);
  });

  it("starts over from a full snapshot after a failure, and retries at once", async () => {
    let t = 0;
    const service = new TorrentService({ minIntervalMs: 1000, now: () => t });
    const { client, rids } = fakeClient([
      { rid: 5, full_update: true, torrents: { a: { name: "one" } } },
      new QbtError("network", "down"),
      { rid: 8, full_update: true, torrents: { a: { name: "back" } } },
    ]);

    await service.snapshot(client);
    t = 2000;
    const err = await caught(service.snapshot(client));
    expect(err instanceof QbtError).toBe(true);
    // Not rate-limited by the failure: the very next call tries again, from rid 0.
    expect(names(await service.snapshot(client))).toEqual(["back"]);
    expect(rids).toEqual([0, 5, 0]);
  });

  it("forgets state on reset and discards a reply to a request made before it", async () => {
    const service = new TorrentService({ minIntervalMs: 1000, now: () => 0 });
    const gate = deferred<MainDataUpdate>();
    const slow = {
      async getMainData() {
        return gate.promise;
      },
    } as unknown as QbtClient;

    const stale = service.snapshot(slow); // in flight against the old settings
    service.reset();
    gate.resolve({
      rid: 99,
      full_update: true,
      torrents: { old: { name: "from-old-server" } },
    });
    const result = await stale;

    expect(result.torrents).toEqual([]); // the old server's data was not kept
    expect(result.sync.rid).toBe(0);
  });
});
