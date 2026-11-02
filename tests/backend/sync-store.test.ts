import { describe, expect, it } from "vitest";
import { ETA_INFINITY, SyncStore } from "../../src/backend/sync-store.js";

const full = {
  rid: 1,
  full_update: true,
  torrents: {
    aaa: {
      name: "debian.iso",
      state: "downloading",
      progress: 0.25,
      size: 1000,
      dlspeed: 500,
      upspeed: 10,
      eta: 90,
      ratio: 0.5,
      num_seeds: 3,
      num_leechs: 1,
      category: "linux",
      tags: "iso, new",
      added_on: 1700000000,
    },
    bbb: {
      name: "ubuntu.iso",
      state: "stoppedUP",
      progress: 1,
      eta: ETA_INFINITY,
    },
  },
  categories: { linux: { name: "linux" } },
  tags: ["iso", "new"],
  server_state: {
    dl_info_speed: 500,
    up_info_speed: 10,
    connection_status: "connected",
  },
};

describe("SyncStore", () => {
  it("turns a full update into rows with defaults and parsed tags", () => {
    const store = new SyncStore();
    store.apply(full);
    const snap = store.snapshot();

    expect(store.rid).toBe(1);
    expect(snap.sync).toEqual({ rid: 1, fullUpdate: true });
    expect(snap.torrents.length).toBe(2);
    expect(snap.torrents[0]).toEqual({
      hash: "aaa",
      name: "debian.iso",
      state: "downloading",
      progress: 0.25,
      size: 1000,
      downloadSpeed: 500,
      uploadSpeed: 10,
      eta: 90,
      ratio: 0.5,
      seeds: 3,
      leechers: 1,
      category: "linux",
      tags: ["iso", "new"],
      addedOn: 1700000000,
      priority: null,
      savePath: "",
      contentPath: "",
    });
    // Missing fields default; an infinite ETA becomes null.
    expect(snap.torrents[1].eta).toBe(null);
    expect(snap.torrents[1].tags).toEqual([]);
    expect(snap.torrents[1].size).toBe(0);
    expect(snap.categories).toEqual(["linux"]);
    expect(snap.tags).toEqual(["iso", "new"]);
    expect(snap.serverState.downloadSpeed).toBe(500);
    expect(snap.serverState.connectionStatus).toBe("connected");
    expect(snap.serverState.altSpeedEnabled).toBe(false);
  });

  it("merges a delta into the torrent it names and leaves the others alone", () => {
    const store = new SyncStore();
    store.apply(full);
    store.apply({
      rid: 2,
      torrents: { aaa: { progress: 0.5, dlspeed: 700, eta: 40 } },
      server_state: { dl_info_speed: 700, use_alt_speed_limits: true },
    });
    const snap = store.snapshot();

    expect(snap.sync).toEqual({ rid: 2, fullUpdate: false });
    expect(snap.torrents[0].progress).toBe(0.5);
    expect(snap.torrents[0].downloadSpeed).toBe(700);
    expect(snap.torrents[0].name).toBe("debian.iso"); // untouched field survives
    expect(snap.torrents[1].state).toBe("stoppedUP");
    expect(snap.serverState.downloadSpeed).toBe(700);
    expect(snap.serverState.uploadSpeed).toBe(10); // untouched server field survives
    expect(snap.serverState.altSpeedEnabled).toBe(true);
  });

  it("removes torrents, categories and tags listed as removed", () => {
    const store = new SyncStore();
    store.apply(full);
    store.apply({
      rid: 2,
      torrents_removed: ["aaa"],
      categories_removed: ["linux"],
      tags_removed: ["new"],
    });
    const snap = store.snapshot();

    expect(snap.torrents.map((t) => t.hash)).toEqual(["bbb"]);
    expect(snap.categories).toEqual([]);
    expect(snap.tags).toEqual(["iso"]);
  });

  it("replaces everything on a full update instead of merging into stale state", () => {
    const store = new SyncStore();
    store.apply(full);
    // The server answers fully again (for example the rid no longer matched), and aaa is gone.
    store.apply({
      rid: 9,
      full_update: true,
      torrents: { ccc: { name: "new.iso" } },
    });
    const snap = store.snapshot();

    expect(snap.torrents.map((t) => t.hash)).toEqual(["ccc"]);
    expect(snap.categories).toEqual([]);
    expect(snap.tags).toEqual([]);
    expect(snap.serverState.downloadSpeed).toBe(0);
    expect(snap.sync).toEqual({ rid: 9, fullUpdate: true });
  });

  it("forgets everything on reset and asks for a full snapshot again", () => {
    const store = new SyncStore();
    store.apply(full);
    store.reset();

    expect(store.rid).toBe(0);
    expect(store.snapshot().torrents).toEqual([]);
    expect(store.snapshot().sync).toEqual({ rid: 0, fullUpdate: false });
  });

  it("reads the queue position and paths, treating -1 as outside the queue", () => {
    const store = new SyncStore();
    store.apply({
      rid: 1,
      full_update: true,
      torrents: {
        aaa: {
          priority: 3,
          save_path: "/dl/",
          content_path: "/dl/a",
        },
        bbb: { priority: -1 },
      },
      server_state: { queueing: true },
    });
    const snap = store.snapshot();
    expect(snap.torrents[0]).toMatchObject({
      priority: 3,
      savePath: "/dl/",
      contentPath: "/dl/a",
    });
    expect(snap.torrents[1].priority).toBe(null);
    expect(snap.serverState.queueing).toBe(true);
  });
});
