import { QbtError, normalizeBaseUrl } from "./qbittorrent/client.js";

/**
 * Admin settings check, for ctx.settings.onValidate("admin", ...). Returns
 * field key to message; an empty object means the save is fine. An empty URL
 * is allowed so the plugin can be installed before it is configured.
 */
export function validateAdminSettings(
  values: Record<string, unknown>,
): Record<string, string> {
  return { ...validateBaseUrl(values.baseUrl), ...validatePrefixes(values) };
}

function validateBaseUrl(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    normalizeBaseUrl(raw);
  } catch (err) {
    if (err instanceof QbtError) return { baseUrl: err.message };
    throw err;
  }
  return {};
}

function validatePrefixes(
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const from = text(values.qbtPathPrefix);
  const to = text(values.hostPathPrefix);
  if (from && !to)
    errors.hostPathPrefix = "Set this too, or clear the qBittorrent path.";
  if (to && !from)
    errors.qbtPathPrefix = "Set this too, or clear the host path.";
  if (from && !isAbsolute(from))
    errors.qbtPathPrefix = "Use an absolute path, for example /downloads.";
  if (to && !isAbsolute(to))
    errors.hostPathPrefix = "Use an absolute path, for example /mnt/media.";
  return errors;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A POSIX path or a Windows drive path, since qBittorrent can run on either. */
function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export interface LocationConfig {
  /** The Termix host holding the downloads, or null when none is set. */
  hostId: string | null;
  /** The start of qBittorrent's paths that `hostPrefix` replaces. Empty for no mapping. */
  qbtPrefix: string;
  hostPrefix: string;
}

export function toLocationConfig(
  values: Record<string, unknown>,
): LocationConfig {
  const hostId = values.fileHostId;
  return {
    hostId:
      (typeof hostId === "string" && hostId.trim()) ||
      typeof hostId === "number"
        ? String(hostId).trim()
        : null,
    qbtPrefix: text(values.qbtPathPrefix),
    hostPrefix: text(values.hostPathPrefix),
  };
}
