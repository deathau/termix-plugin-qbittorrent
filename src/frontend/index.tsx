import { useEffect, useMemo, useState } from "react";
import {
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  FILTERS,
  countByFilter,
  formatBytes,
  formatEta,
  formatPercent,
  formatRatio,
  formatSpeed,
  matchesFilter,
  sortRows,
  type Filter,
  type SortDir,
  type SortKey,
  type TorrentsBody,
  type TorrentsOk,
} from "./torrents.js";

const TAB_ID = "qbittorrent";
const POLL_MS = 3000;

const COLUMNS: { key: SortKey; labelKey: string; align?: "right" }[] = [
  { key: "name", labelKey: "tab.columns.name" },
  { key: "state", labelKey: "tab.columns.status" },
  { key: "progress", labelKey: "tab.columns.progress" },
  { key: "size", labelKey: "tab.columns.size", align: "right" },
  { key: "downloadSpeed", labelKey: "tab.columns.down", align: "right" },
  { key: "uploadSpeed", labelKey: "tab.columns.up", align: "right" },
  { key: "eta", labelKey: "tab.columns.eta", align: "right" },
  { key: "ratio", labelKey: "tab.columns.ratio", align: "right" },
];

// Lucide "download".
function DownloadIcon(props: { className?: string }) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function createTab(app: TermixApp) {
  return function QbittorrentTab({ isVisible }: TabProps) {
    const { t } = useTranslation();
    const [data, setData] = useState<TorrentsOk | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
      key: "addedOn",
      dir: "desc",
    });
    // Bumping this restarts the polling loop straight away (the Retry button).
    const [nonce, setNonce] = useState(0);

    // Poll only while the tab is showing. The next request is scheduled after
    // the previous one finishes, so a slow qBittorrent never piles up requests.
    useEffect(() => {
      if (!isVisible) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const tick = async () => {
        try {
          const { data: body } = await app.api.get<TorrentsBody>("/torrents");
          if (cancelled) return;
          if (body.ok) {
            setData(body);
            setError(null);
          } else {
            // Keep showing the last good data, with the reason above it.
            setError(body.error.message);
          }
        } catch {
          if (!cancelled) setError(t("tab.failed"));
        }
        if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
      };

      void tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, [isVisible, nonce]);

    const rows = useMemo(
      () =>
        sortRows(
          (data?.torrents ?? []).filter((row) =>
            matchesFilter(row, filter, query),
          ),
          sort.key,
          sort.dir,
        ),
      [data, filter, query, sort],
    );
    const counts = useMemo(() => countByFilter(data?.torrents ?? []), [data]);

    const toggleSort = (key: SortKey) =>
      setSort((current) =>
        current.key === key
          ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "name" || key === "state" ? "asc" : "desc" },
      );

    const state = data?.serverState;

    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 className="text-lg font-semibold">{t("tab.title")}</h2>
          {state && (
            <p className="text-sm text-muted-foreground">
              {"\u2193"} {formatSpeed(state.downloadSpeed)} {"\u00a0\u00a0"}
              {"\u2191"} {formatSpeed(state.uploadSpeed)}
              {state.altSpeedEnabled && ` \u00b7 ${t("tab.altSpeed")}`}
              {state.connectionStatus !== "connected" &&
                ` \u00b7 ${t("tab.connection", { status: state.connectionStatus })}`}
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">{error}</p>
            <button
              type="button"
              className="border border-border px-3 py-1 text-sm"
              onClick={() => setNonce((n) => n + 1)}
            >
              {t("tab.retry")}
            </button>
          </div>
        )}

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`border border-border px-3 py-1 text-sm ${
                  filter === f ? "bg-muted font-semibold" : ""
                }`}
                onClick={() => setFilter(f)}
              >
                {t(`tab.filters.${f}`)} ({counts[f]})
              </button>
            ))}
            <input
              className="min-w-40 flex-1 border border-border bg-transparent px-2 py-1 text-sm"
              value={query}
              placeholder={t("tab.search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        )}

        {!data && !error && (
          <p className="text-sm text-muted-foreground">{t("tab.loading")}</p>
        )}

        {data && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {data.torrents.length === 0 ? t("tab.empty") : t("tab.noMatch")}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className={`cursor-pointer select-none whitespace-nowrap px-2 py-1 font-medium ${
                        column.align === "right" ? "text-right" : ""
                      }`}
                      onClick={() => toggleSort(column.key)}
                    >
                      {t(column.labelKey)}
                      {sort.key === column.key &&
                        (sort.dir === "asc" ? " \u25b2" : " \u25bc")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.hash} className="border-b border-border">
                    <td
                      className="max-w-md truncate px-2 py-1"
                      title={row.name}
                    >
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {t(`states.${row.state}`, { defaultValue: row.state })}
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.min(100, row.progress * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="whitespace-nowrap">
                          {formatPercent(row.progress)}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatBytes(row.size)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatSpeed(row.downloadSpeed)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatSpeed(row.uploadSpeed)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatEta(row.eta)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {formatRatio(row.ratio)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
}

export function activate(app: TermixApp): void {
  app.registerRailItem({
    id: TAB_ID,
    icon: DownloadIcon,
    titleKey: "tab.title",
    kind: "tab",
    permission: "view",
  });
  app.registerTab(TAB_ID, createTab(app), {
    icon: DownloadIcon,
    titleKey: "tab.title",
    singleton: true,
    hostless: true,
  });
}
