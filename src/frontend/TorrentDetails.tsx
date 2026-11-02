import { useEffect, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { Button, GroupHeading, InlineView } from "@termix-ssh/plugin-sdk/ui";
import {
  formatBytes,
  formatDate,
  formatEta,
  formatPercent,
  formatRatio,
  realTrackers,
  type DetailsBody,
  type DetailsOk,
  type TorrentRow,
} from "./torrents.js";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
}

export function TorrentDetails({
  app,
  row,
  pollMs,
  isVisible,
  canOpenLocation,
  onOpenLocation,
  onClose,
}: {
  app: TermixApp;
  /** The torrent shown, or null when the view is closed. */
  row: TorrentRow | null;
  pollMs: number;
  isVisible: boolean;
  canOpenLocation: boolean;
  onOpenLocation: (row: TorrentRow) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const hash = row?.hash ?? null;
  const [details, setDetails] = useState<DetailsOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetails(null);
    setError(null);
    if (!hash || !isVisible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const { data: body } = await app.api.get<DetailsBody>(
          `/torrents/${hash}/details`,
        );
        if (cancelled) return;
        if (body.ok === false) {
          setError(body.error.message);
        } else {
          setDetails(body);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(t("tab.failed"));
      }
      if (!cancelled) timer = setTimeout(() => void tick(), pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hash, isVisible]);

  const p = details?.properties;
  const trackers = realTrackers(details?.trackers ?? []);

  return (
    <InlineView
      open={row !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={row?.name ?? ""}
      actions={
        row &&
        canOpenLocation && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenLocation(row)}
          >
            {t("tab.actions.openLocation")}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 p-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}
        {!details && !error && (
          <p className="text-muted-foreground">{t("tab.details.loading")}</p>
        )}

        {p && (
          <section className="flex flex-col gap-2">
            <GroupHeading title={t("tab.details.general")} />
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
              <Fact label={t("tab.details.savePath")} value={p.save_path} />
              <Fact
                label={t("tab.details.size")}
                value={formatBytes(p.total_size)}
              />
              <Fact
                label={t("tab.details.downloaded")}
                value={formatBytes(p.total_downloaded)}
              />
              <Fact
                label={t("tab.details.uploaded")}
                value={formatBytes(p.total_uploaded)}
              />
              <Fact
                label={t("tab.details.ratio")}
                value={formatRatio(p.share_ratio)}
              />
              <Fact
                label={t("tab.details.pieces")}
                value={`${p.pieces_have} / ${p.pieces_num}`}
              />
              <Fact
                label={t("tab.details.pieceSize")}
                value={formatBytes(p.piece_size)}
              />
              <Fact
                label={t("tab.details.connections")}
                value={String(p.nb_connections)}
              />
              <Fact
                label={t("tab.details.elapsed")}
                value={formatEta(p.time_elapsed)}
              />
              <Fact
                label={t("tab.details.seeding")}
                value={formatEta(p.seeding_time)}
              />
              <Fact
                label={t("tab.details.added")}
                value={formatDate(p.addition_date)}
              />
              <Fact
                label={t("tab.details.completed")}
                value={formatDate(p.completion_date)}
              />
              <Fact
                label={t("tab.details.created")}
                value={formatDate(p.creation_date)}
              />
              {p.created_by && (
                <Fact label={t("tab.details.createdBy")} value={p.created_by} />
              )}
              {p.comment && (
                <Fact label={t("tab.details.comment")} value={p.comment} />
              )}
            </dl>
          </section>
        )}

        {details && (
          <section className="flex flex-col gap-2">
            <GroupHeading
              title={t("tab.details.files")}
              count={details.files.length}
            />
            {details.files.length === 0 ? (
              <p className="text-muted-foreground">
                {t("tab.details.noFiles")}
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-2 py-1 font-medium">
                        {t("tab.details.fileName")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("tab.details.fileSize")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("tab.details.fileProgress")}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t("tab.details.filePriority")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.files.map((file) => (
                      <tr key={file.index} className="border-b border-border">
                        <td className="break-all px-2 py-1">{file.name}</td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          {formatBytes(file.size)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          {formatPercent(file.progress)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {t(`tab.filePriority.${file.priority}`, {
                            defaultValue: String(file.priority),
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {details && (
          <section className="flex flex-col gap-2">
            <GroupHeading
              title={t("tab.details.trackers")}
              count={trackers.length}
            />
            {trackers.length === 0 ? (
              <p className="text-muted-foreground">
                {t("tab.details.noTrackers")}
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-2 py-1 font-medium">
                        {t("tab.details.trackerUrl")}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t("tab.details.trackerStatus")}
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        {t("tab.details.trackerPeers")}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t("tab.details.trackerMessage")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trackers.map((tracker) => (
                      <tr key={tracker.url} className="border-b border-border">
                        <td className="break-all px-2 py-1">{tracker.url}</td>
                        <td className="whitespace-nowrap px-2 py-1">
                          {t(`tab.trackerStatus.${tracker.status}`, {
                            defaultValue: String(tracker.status),
                          })}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-right">
                          {tracker.num_peers < 0 ? "—" : tracker.num_peers}
                        </td>
                        <td className="break-words px-2 py-1">{tracker.msg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </InlineView>
  );
}
