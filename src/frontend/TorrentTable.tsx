import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Checkbox } from "@termix-ssh/plugin-sdk/ui";
import {
  formatBytes,
  formatEta,
  formatPercent,
  formatRatio,
  formatSpeed,
  type SortDir,
  type SortKey,
  type TorrentRow,
} from "./torrents.js";

const COLUMNS: { key: SortKey; labelKey: string; align?: "right" }[] = [
  { key: "priority", labelKey: "tab.columns.queue", align: "right" },
  { key: "name", labelKey: "tab.columns.name" },
  { key: "state", labelKey: "tab.columns.status" },
  { key: "progress", labelKey: "tab.columns.progress" },
  { key: "size", labelKey: "tab.columns.size", align: "right" },
  { key: "downloadSpeed", labelKey: "tab.columns.down", align: "right" },
  { key: "uploadSpeed", labelKey: "tab.columns.up", align: "right" },
  { key: "eta", labelKey: "tab.columns.eta", align: "right" },
  { key: "ratio", labelKey: "tab.columns.ratio", align: "right" },
];

export function TorrentTable({
  rows,
  sort,
  onSort,
  selected,
  onSelect,
  onOpen,
}: {
  rows: TorrentRow[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  selected: ReadonlySet<string>;
  onSelect: (hashes: string[], checked: boolean) => void;
  onOpen: (row: TorrentRow) => void;
}) {
  const { t } = useTranslation();
  const selectedCount = rows.filter((row) => selected.has(row.hash)).length;

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="w-8 px-2 py-1">
              <Checkbox
                aria-label={t("tab.selectAll")}
                checked={
                  selectedCount === 0
                    ? false
                    : selectedCount === rows.length
                      ? true
                      : "indeterminate"
                }
                onCheckedChange={(checked) =>
                  onSelect(
                    rows.map((row) => row.hash),
                    checked === true,
                  )
                }
              />
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={`cursor-pointer select-none whitespace-nowrap px-2 py-1 font-medium ${
                  column.align === "right" ? "text-right" : ""
                }`}
                onClick={() => onSort(column.key)}
              >
                {t(column.labelKey)}
                {sort.key === column.key && (sort.dir === "asc" ? " ▲" : " ▼")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.hash}
              className="cursor-pointer border-b border-border hover:bg-muted"
              onClick={() => onOpen(row)}
            >
              <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={t("tab.selectRow", { name: row.name })}
                  checked={selected.has(row.hash)}
                  onCheckedChange={(checked) =>
                    onSelect([row.hash], checked === true)
                  }
                />
              </td>
              <td className="whitespace-nowrap px-2 py-1 text-right">
                {row.priority ?? "—"}
              </td>
              <td className="max-w-md truncate px-2 py-1" title={row.name}>
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
                      style={{ width: `${Math.min(100, row.progress * 100)}%` }}
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
  );
}
