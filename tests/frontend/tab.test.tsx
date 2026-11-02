import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;
const ALL = ["qbittorrent.view", "qbittorrent.manage", "qbittorrent.delete"];
const HASH = "a".repeat(40);

function torrent(over: Record<string, unknown> = {}) {
  return {
    hash: HASH,
    name: "debian.iso",
    state: "downloading",
    progress: 0.5,
    size: 1024,
    downloadSpeed: 0,
    uploadSpeed: 0,
    eta: null,
    ratio: 0,
    seeds: 0,
    leechers: 0,
    category: "",
    tags: [],
    addedOn: 1,
    priority: 1,
    savePath: "/downloads",
    contentPath: "/downloads/debian.iso",
    ...over,
  };
}

function stubApi(queueing = true) {
  return {
    get: vi.fn(async (path: string) => {
      if (path === "/location-config")
        return {
          data: {
            ok: true,
            hostId: null,
            qbtPrefix: "",
            hostPrefix: "",
          },
        };
      if (path.endsWith("/details"))
        return {
          data: {
            ok: true,
            properties: {
              save_path: "/downloads",
              comment: "",
              created_by: "",
              creation_date: 1,
              addition_date: 1,
              completion_date: -1,
              total_size: 1024,
              total_downloaded: 512,
              total_uploaded: 0,
              piece_size: 1024,
              pieces_have: 0,
              pieces_num: 1,
              share_ratio: 0,
              time_elapsed: 60,
              seeding_time: 0,
              nb_connections: 0,
            },
            files: [
              {
                index: 0,
                name: "debian.iso",
                size: 1024,
                progress: 1,
                priority: 1,
              },
            ],
            trackers: [],
          },
        };
      return {
        data: {
          ok: true,
          torrents: [torrent()],
          serverState: {
            downloadSpeed: 0,
            uploadSpeed: 0,
            downloadLimit: 0,
            uploadLimit: 0,
            altSpeedEnabled: false,
            connectionStatus: "connected",
            queueing,
          },
          categories: [],
          tags: [],
          sync: { rid: 1, fullUpdate: true },
        },
      };
    }),
    post: vi.fn(async () => ({ data: { ok: true } })),
  };
}

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

async function open(permissions: string[], api = stubApi()) {
  rendered = await renderWithApp(plugin, {
    manifest,
    locales,
    permissions,
    api: api as never,
  });
  rendered.renderTab("qbittorrent", { isVisible: true });
  await screen.findByText("debian.iso");
  return api;
}

function selectRow() {
  fireEvent.click(screen.getByRole("checkbox", { name: "Select debian.iso" }));
}

describe("translations", () => {
  it("has every key the source asks for", () => {
    const dir = join(process.cwd(), "src/frontend");
    const sources = readdirSync(dir).map((file) =>
      readFileSync(join(dir, file), "utf8"),
    );
    const lookup = (path: string[]) =>
      path.reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        locales,
      );
    const has = (key: string) => {
      const path = key.split(".");
      // Plural keys are stored as key_one and key_other.
      return (
        lookup(path) !== undefined ||
        lookup([...path.slice(0, -1), `${path.at(-1)}_other`]) !== undefined
      );
    };
    const keys = sources.flatMap((source) =>
      [...source.matchAll(/["'](?:tab|settings|states)\.[\w.]+["']/g)].map(
        (m) => m[0].slice(1, -1),
      ),
    );
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((key) => !has(key))).toEqual([]);
  });
});

describe("qbittorrent tab", () => {
  it("registers the tab and the host picker", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["qbittorrent"]);
    expect(rendered.registered.settingsComponents()).toEqual(
      expect.arrayContaining([expect.stringContaining("host-picker")]),
    );
  });

  it("sends an action for the selected torrent", async () => {
    const api = await open(ALL);
    selectRow();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/torrents/actions", {
        action: "stop",
        hashes: [HASH],
        value: undefined,
      }),
    );
  });

  it("disables queue moves when queueing is off", async () => {
    await open(ALL, stubApi(false));
    selectRow();
    const top = screen.getByRole("button", {
      name: "Move to top",
    }) as HTMLButtonElement;
    expect(top.disabled).toBe(true);
  });

  it("hides what a viewer can't do", async () => {
    await open(["qbittorrent.view"]);
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    selectRow();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("keeps files by default when deleting", async () => {
    const api = await open(ALL);
    selectRow();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const prompt = await screen.findByText("Delete 1 torrent?");
    expect(prompt).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/torrents/delete", {
        hashes: [HASH],
        deleteFiles: false,
      }),
    );
  });

  it("shows files in the details view", async () => {
    await open(ALL);
    fireEvent.click(screen.getByText("debian.iso"));
    expect(await screen.findByText("Files")).toBeTruthy();
    const table = (await screen.findByText("Priority")).closest("table")!;
    expect(within(table).getByText("debian.iso")).toBeTruthy();
    expect(within(table).getByText("Normal")).toBeTruthy();
  });

  it("explains why Open location is unavailable", async () => {
    await open(ALL);
    selectRow();
    const button = screen.getByRole("button", {
      name: "Open location",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("Termix host");
  });
});
