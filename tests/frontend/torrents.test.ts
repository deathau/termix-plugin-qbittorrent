import { describe, expect, it } from "vitest";
import {
  countByFilter,
  formatBytes,
  formatEta,
  formatPercent,
  formatRatio,
  formatSpeed,
  matchesFilter,
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
