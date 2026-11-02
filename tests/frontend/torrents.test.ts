import { describe, expect, it } from "vitest";
import {
  countByFilter,
  formatBytes,
  formatDate,
  formatEta,
  formatPercent,
  formatRatio,
  formatSpeed,
  locationPath,
  mapPath,
  matchesFilter,
  parentPath,
  parseLinks,
  parseTags,
  realTrackers,
  sortRows,
  stateGroup,
  type TorrentRow,
} from "../../src/frontend/torrents.js";

function row(over: Partial<TorrentRow>): TorrentRow {
  return {
    hash: over.hash ?? over.name ?? "x",
    name: "torrent",
    state: "downloading",
    progress: 0,
    size: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    eta: null,
    ratio: 0,
    seeds: 0,
    leechers: 0,
    category: "",
    tags: [],
    addedOn: 0,
    priority: null,
    savePath: "",
    contentPath: "",
    ...over,
  };
}

const names = (rows: TorrentRow[]) => rows.map((r) => r.name);

describe("stateGroup", () => {
  it("groups the states in the API reference", () => {
    expect(stateGroup("downloading")).toBe("downloading");
    expect(stateGroup("stalledDL")).toBe("downloading");
    expect(stateGroup("metaDL")).toBe("downloading");
    expect(stateGroup("uploading")).toBe("seeding");
    expect(stateGroup("stalledUP")).toBe("seeding");
    expect(stateGroup("error")).toBe("errored");
    expect(stateGroup("missingFiles")).toBe("errored");
  });

  it("treats paused and stopped as the same thing", () => {
    for (const s of ["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"])
      expect(stateGroup(s)).toBe("paused");
  });

  it("puts anything unrecognised in other", () => {
    expect(stateGroup("moving")).toBe("other");
    expect(stateGroup("somethingNew")).toBe("other");
  });
});

describe("filtering", () => {
  const rows = [
    row({ name: "Debian ISO", state: "downloading" }),
    row({ name: "Ubuntu ISO", state: "stalledUP" }),
    row({ name: "Fedora", state: "stoppedDL" }),
    row({ name: "Broken", state: "missingFiles" }),
    row({ name: "Moving one", state: "moving" }),
  ];

  it("filters by group and ignores case in the text search", () => {
    expect(names(rows.filter((r) => matchesFilter(r, "seeding", "")))).toEqual([
      "Ubuntu ISO",
    ]);
    expect(names(rows.filter((r) => matchesFilter(r, "all", "iso")))).toEqual([
      "Debian ISO",
      "Ubuntu ISO",
    ]);
    expect(
      names(rows.filter((r) => matchesFilter(r, "downloading", "  DEBIAN "))),
    ).toEqual(["Debian ISO"]);
  });

  it("counts each group, leaving unrecognised states only in all", () => {
    expect(countByFilter(rows)).toEqual({
      all: 5,
      downloading: 1,
      seeding: 1,
      paused: 1,
      errored: 1,
    });
  });
});

describe("sortRows", () => {
  it("sorts names naturally and ignores case", () => {
    const rows = [
      row({ name: "b 10" }),
      row({ name: "a" }),
      row({ name: "B 2" }),
    ];
    expect(names(sortRows(rows, "name", "asc"))).toEqual(["a", "B 2", "b 10"]);
    expect(names(sortRows(rows, "name", "desc"))).toEqual(["b 10", "B 2", "a"]);
  });

  it("sorts numbers and does not change the input", () => {
    const rows = [
      row({ name: "a", size: 5 }),
      row({ name: "b", size: 50 }),
      row({ name: "c", size: 1 }),
    ];
    expect(names(sortRows(rows, "size", "desc"))).toEqual(["b", "a", "c"]);
    expect(names(rows)).toEqual(["a", "b", "c"]);
  });

  it("puts an unknown ETA last when ascending and first when descending", () => {
    const rows = [
      row({ name: "never", eta: null }),
      row({ name: "soon", eta: 30 }),
      row({ name: "later", eta: 3000 }),
    ];
    expect(names(sortRows(rows, "eta", "asc"))).toEqual([
      "soon",
      "later",
      "never",
    ]);
    expect(names(sortRows(rows, "eta", "desc"))).toEqual([
      "never",
      "later",
      "soon",
    ]);
  });

  it("breaks ties by name so the order does not jump between polls", () => {
    const rows = [
      row({ name: "b", ratio: 1 }),
      row({ name: "a", ratio: 1 }),
      row({ name: "c", ratio: 1 }),
    ];
    expect(names(sortRows(rows, "ratio", "desc"))).toEqual(["a", "b", "c"]);
  });
});

describe("formatting", () => {
  it("formats bytes in binary units with sensible precision", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(1536)).toBe("1.50 KiB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MiB");
    expect(formatBytes(150 * 1024 ** 3)).toBe("150 GiB");
    expect(formatBytes(-1)).toBe("\u2014");
  });

  it("shows an idle speed as a dash", () => {
    expect(formatSpeed(0)).toBe("\u2014");
    expect(formatSpeed(2048)).toBe("2.00 KiB/s");
  });

  it("formats an ETA with its two largest units", () => {
    expect(formatEta(null)).toBe("\u221e");
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(125)).toBe("2m 5s");
    expect(formatEta(3725)).toBe("1h 2m");
    expect(formatEta(90_000)).toBe("1d 1h");
  });

  it("formats ratio and percent", () => {
    expect(formatRatio(1.234)).toBe("1.23");
    expect(formatRatio(-1)).toBe("\u2014");
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(0.9996)).toBe("99.9%");
    expect(formatPercent(1)).toBe("100.0%");
    expect(formatPercent(1.5)).toBe("100.0%");
  });
});

describe("sorting by queue position", () => {
  const rows = [
    row({ name: "seed", priority: null }),
    row({ name: "second", priority: 2 }),
    row({ name: "first", priority: 1 }),
  ];
  const names = (sorted: TorrentRow[]) => sorted.map((r) => r.name);

  it("orders by position, with torrents outside the queue last", () => {
    expect(names(sortRows(rows, "priority", "asc"))).toEqual([
      "first",
      "second",
      "seed",
    ]);
  });

  it("keeps torrents outside the queue last when reversed", () => {
    expect(names(sortRows(rows, "priority", "desc"))).toEqual([
      "second",
      "first",
      "seed",
    ]);
  });
});

describe("parseLinks and parseTags", () => {
  it("splits on lines, dropping blanks and spaces", () => {
    expect(parseLinks("  magnet:?a \r\n\n http://b/c\n")).toEqual([
      "magnet:?a",
      "http://b/c",
    ]);
  });

  it("splits tags on commas", () => {
    expect(parseTags(" a, b ,,")).toEqual(["a", "b"]);
  });
});

describe("mapPath", () => {
  it("swaps a matching prefix", () => {
    expect(mapPath("/downloads/a/b", "/downloads", "/mnt/media")).toBe(
      "/mnt/media/a/b",
    );
    expect(mapPath("/downloads", "/downloads", "/mnt/media")).toBe(
      "/mnt/media",
    );
  });

  it("matches whole segments only", () => {
    expect(mapPath("/downloads2/a", "/downloads", "/mnt")).toBe(
      "/downloads2/a",
    );
  });

  it("ignores trailing slashes on either prefix", () => {
    expect(mapPath("/downloads/a", "/downloads/", "/mnt/")).toBe("/mnt/a");
  });

  it("leaves paths alone without a mapping or outside it", () => {
    expect(mapPath("/data/a", "", "")).toBe("/data/a");
    expect(mapPath("/data/a", "/downloads", "/mnt")).toBe("/data/a");
  });

  it("handles the root on either side", () => {
    expect(mapPath("/a", "/", "/mnt")).toBe("/mnt/a");
    expect(mapPath("/downloads", "/downloads", "/")).toBe("/");
  });

  it("converts a Windows path for a POSIX host", () => {
    expect(mapPath("D:\\dl\\a\\b", "D:\\dl", "/mnt/dl")).toBe("/mnt/dl/a/b");
  });
});

describe("parentPath", () => {
  it("finds the folder for POSIX and Windows paths", () => {
    expect(parentPath("/a/b.iso")).toBe("/a");
    expect(parentPath("/b.iso")).toBe("/");
    expect(parentPath("D:\\dl\\b.iso")).toBe("D:\\dl");
    expect(parentPath("D:\\b.iso")).toBe("D:\\");
  });
});

describe("locationPath", () => {
  const config = { qbtPrefix: "/downloads", hostPrefix: "/mnt" };
  const single = {
    savePath: "/downloads/",
    contentPath: "/downloads/tmp/a.iso",
  };
  const multi = { savePath: "/downloads/", contentPath: "/downloads/show" };

  it("opens the parent of a single file, even outside savePath", () => {
    expect(locationPath(single, [{ name: "a.iso" }], config)).toBe("/mnt/tmp");
  });

  it("opens the torrent's own folder when it has one", () => {
    expect(locationPath(multi, [{ name: "show/1.mkv" }], config)).toBe(
      "/mnt/show",
    );
    expect(
      locationPath(multi, [{ name: "1.mkv" }, { name: "2.mkv" }], config),
    ).toBe("/mnt/show");
  });

  it("falls back to savePath before the file list exists", () => {
    expect(locationPath(multi, [], config)).toBe("/mnt/");
  });
});

describe("formatDate", () => {
  it("shows a dash for unknown dates", () => {
    expect(formatDate(-1)).toBe("\u2014");
    expect(formatDate(0)).toBe("\u2014");
    expect(formatDate(1_700_000_000)).not.toBe("\u2014");
  });
});

describe("realTrackers", () => {
  it("drops the placeholder entries", () => {
    const tracker = (url: string, tier: number) => ({
      url,
      tier,
      status: 2,
      num_peers: 0,
      num_seeds: 0,
      num_leeches: 0,
      msg: "",
    });
    expect(
      realTrackers([tracker("** [DHT] **", -1), tracker("http://t", 0)]).map(
        (t) => t.url,
      ),
    ).toEqual(["http://t"]);
  });
});
