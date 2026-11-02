import { useEffect, useMemo, useState } from "react";
import {
  usePermission,
  useToast,
  useTranslation,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  AddButton,
  Button,
  PanelSearch,
  PanelShell,
  PanePrompt,
  PROMPT_BUTTON,
  PROMPT_DESTRUCTIVE_BUTTON,
  Segmented,
  SwitchRow,
  useInstalledPlugins,
} from "@termix-ssh/plugin-sdk/ui";
import { AddTorrentView } from "./AddTorrentView.js";
import { HOST_PICKER_ID, HostPicker } from "./HostPicker.js";
import { TorrentDetails } from "./TorrentDetails.js";
import { TorrentTable } from "./TorrentTable.js";
import { useTorrents } from "./useTorrents.js";
import {
  FILTERS,
  countByFilter,
  formatSpeed,
  locationPath,
  matchesFilter,
  sortRows,
  type DetailsBody,
  type DoneBody,
  type Filter,
  type LocationConfig,
  type SortDir,
  type SortKey,
  type TorrentAction,
  type TorrentRow,
} from "./torrents.js";

const TAB_ID = "qbittorrent";
// Another plugin's id and action, not an SDK API. Calling it while that plugin
// is off does nothing and reports nothing, so its presence is checked first.
const FILE_MANAGER_ID = "file-manager";
const OPEN_FILES_ACTION = "files.openHost";

const SIMPLE_ACTIONS: {
  action: TorrentAction;
  labelKey: string;
  value?: boolean;
}[] = [
  { action: "start", labelKey: "tab.actions.start" },
  { action: "stop", labelKey: "tab.actions.stop" },
  { action: "setForceStart", labelKey: "tab.actions.forceStart", value: true },
  { action: "recheck", labelKey: "tab.actions.recheck" },
  { action: "reannounce", labelKey: "tab.actions.reannounce" },
];

const QUEUE_ACTIONS: { action: TorrentAction; labelKey: string }[] = [
  { action: "topPrio", labelKey: "tab.actions.queueTop" },
  { action: "increasePrio", labelKey: "tab.actions.queueUp" },
  { action: "decreasePrio", labelKey: "tab.actions.queueDown" },
  { action: "bottomPrio", labelKey: "tab.actions.queueBottom" },
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
    const toast = useToast();
    const canManage = usePermission("manage");
    const canDelete = usePermission("delete");
    const plugins = useInstalledPlugins();
    const { data, error, refresh, pollMs } = useTorrents(app, isVisible);

    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
      key: "addedOn",
      dir: "desc",
    });
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [detailHash, setDetailHash] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteFiles, setDeleteFiles] = useState(false);
    const [busy, setBusy] = useState(false);
    const [location, setLocation] = useState<LocationConfig | null>(null);

    const torrents = data?.torrents ?? [];

    useEffect(() => {
      if (!isVisible) return;
      void app.api
        .get<{ ok: true } & LocationConfig>("/location-config")
        .then(({ data: body }) => setLocation(body))
        .catch(() => setLocation(null));
    }, [isVisible]);

    // A torrent removed elsewhere must not stay selected, or a later action
    // would quietly apply to nothing, and its details have nothing to show.
    useEffect(() => {
      if (!data) return;
      const known = new Set(torrents.map((row) => row.hash));
      setSelected((current) =>
        [...current].every((hash) => known.has(hash))
          ? current
          : new Set([...current].filter((hash) => known.has(hash))),
      );
      setDetailHash((current) =>
        current && known.has(current) ? current : null,
      );
    }, [data]);

    const rows = useMemo(
      () =>
        sortRows(
          torrents.filter((row) => matchesFilter(row, filter, query)),
          sort.key,
          sort.dir,
        ),
      [data, filter, query, sort],
    );
    const counts = useMemo(() => countByFilter(torrents), [data]);
    const hashes = [...selected];
    const detailRow = torrents.find((row) => row.hash === detailHash) ?? null;

    const fileManagerOn = plugins.some(
      (plugin) => plugin.id === FILE_MANAGER_ID && plugin.enabled,
    );
    const locationBlocked = !location?.hostId
      ? t("tab.location.noHost")
      : !fileManagerOn
        ? t("tab.location.noFileManager")
        : null;

    const toggleSort = (key: SortKey) =>
      setSort((current) =>
        current.key === key
          ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
          : {
              key,
              dir:
                key === "name" || key === "state" || key === "priority"
                  ? "asc"
                  : "desc",
            },
      );

    const select = (changed: string[], checked: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const hash of changed) {
          if (checked) next.add(hash);
          else next.delete(hash);
        }
        return next;
      });

    const send = async (path: string, body: unknown): Promise<boolean> => {
      setBusy(true);
      try {
        const { data: result } = await app.api.post<DoneBody>(path, body);
        if (result.ok === false) {
          toast.error(result.error.message);
          return false;
        }
        refresh();
        return true;
      } catch (err) {
        const result = (err as { response?: { data?: DoneBody } }).response
          ?.data;
        toast.error(
          result?.ok === false ? result.error.message : t("tab.failedAction"),
        );
        return false;
      } finally {
        setBusy(false);
      }
    };

    const runAction = (action: TorrentAction, value?: boolean) =>
      void send("/torrents/actions", { action, hashes, value });

    const confirmDelete = async () => {
      if (await send("/torrents/delete", { hashes, deleteFiles })) {
        setSelected(new Set());
        setDeleting(false);
        setDeleteFiles(false);
      }
    };

    const openLocation = async (row: TorrentRow) => {
      if (!location?.hostId) return;
      const host = app.getHost(location.hostId);
      if (!host) {
        toast.error(t("tab.location.noAccess"));
        return;
      }
      try {
        const { data: body } = await app.api.get<DetailsBody>(
          `/torrents/${row.hash}/details`,
        );
        if (body.ok === false) {
          toast.error(body.error.message);
          return;
        }
        await app.invokeAction(
          OPEN_FILES_ACTION,
          host,
          locationPath(row, body.files, location),
        );
      } catch {
        toast.error(t("tab.location.failed"));
      }
    };

    const state = data?.serverState;
    const single =
      hashes.length === 1
        ? torrents.find((row) => row.hash === hashes[0])
        : undefined;

    return (
      <PanelShell
        icon={<DownloadIcon className="size-4" />}
        title={t("tab.title")}
        status={
          state && (
            <>
              {"↓"} {formatSpeed(state.downloadSpeed)} {"  "}
              {"↑"} {formatSpeed(state.uploadSpeed)}
              {state.altSpeedEnabled && ` · ${t("tab.altSpeed")}`}
              {state.connectionStatus !== "connected" &&
                ` · ${t("tab.connection", { status: state.connectionStatus })}`}
            </>
          )
        }
        actions={
          canManage && (
            <AddButton label={t("tab.add")} onClick={() => setAdding(true)} />
          )
        }
        toolbar={
          data && (
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={FILTERS.map((f) => ({
                  value: f,
                  label: t(`tab.filters.${f}`),
                  count: counts[f],
                }))}
              />
              <PanelSearch
                value={query}
                onChange={setQuery}
                placeholder={t("tab.search")}
                className="min-w-40 flex-1"
              />
            </div>
          )
        }
      >
        <div className="flex flex-col gap-3 p-4">
          {error && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={refresh}>
                {t("tab.retry")}
              </Button>
            </div>
          )}

          {hashes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-2 text-sm text-muted-foreground">
                {t("tab.selected", { count: hashes.length })}
              </span>
              {canManage &&
                SIMPLE_ACTIONS.map(({ action, labelKey, value }) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => runAction(action, value)}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              {canManage &&
                QUEUE_ACTIONS.map(({ action, labelKey }) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={busy || !state?.queueing}
                    title={state?.queueing ? undefined : t("tab.queueOff")}
                    onClick={() => runAction(action)}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              <Button
                size="sm"
                variant="outline"
                disabled={!single || locationBlocked !== null}
                title={
                  locationBlocked ??
                  (single ? undefined : t("tab.location.selectOne"))
                }
                onClick={() => single && void openLocation(single)}
              >
                {t("tab.actions.openLocation")}
              </Button>
              {canDelete && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  {t("tab.actions.delete")}
                </Button>
              )}
            </div>
          )}

          {!data && !error && (
            <p className="text-sm text-muted-foreground">{t("tab.loading")}</p>
          )}

          {data && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {torrents.length === 0 ? t("tab.empty") : t("tab.noMatch")}
            </p>
          )}

          {rows.length > 0 && (
            <TorrentTable
              rows={rows}
              sort={sort}
              onSort={toggleSort}
              selected={selected}
              onSelect={select}
              onOpen={(row) => setDetailHash(row.hash)}
            />
          )}
        </div>

        <TorrentDetails
          app={app}
          row={detailRow}
          pollMs={pollMs}
          isVisible={isVisible}
          canOpenLocation={locationBlocked === null}
          onOpenLocation={(row) => void openLocation(row)}
          onClose={() => setDetailHash(null)}
        />

        <AddTorrentView
          app={app}
          open={adding}
          onOpenChange={setAdding}
          categories={data?.categories ?? []}
          onAdded={refresh}
        />

        <PanePrompt
          open={deleting}
          tone="destructive"
          title={t("tab.deletePrompt.title", { count: hashes.length })}
          description={t("tab.deletePrompt.description")}
          onCancel={() => setDeleting(false)}
          actions={
            <>
              <button
                type="button"
                className={PROMPT_BUTTON}
                onClick={() => setDeleting(false)}
              >
                {t("tab.deletePrompt.cancel")}
              </button>
              <button
                type="button"
                className={PROMPT_DESTRUCTIVE_BUTTON}
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {t("tab.deletePrompt.confirm")}
              </button>
            </>
          }
        >
          <SwitchRow
            label={t("tab.deletePrompt.deleteFiles")}
            description={t("tab.deletePrompt.deleteFilesHint")}
            checked={deleteFiles}
            onChange={setDeleteFiles}
          />
        </PanePrompt>
      </PanelShell>
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
  app.registerSettingsComponent(HOST_PICKER_ID, HostPicker);
}
