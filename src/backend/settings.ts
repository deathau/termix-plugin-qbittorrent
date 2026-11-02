import { QbtError, normalizeBaseUrl } from "./qbittorrent/client.js";

/**
 * Admin settings check, for ctx.settings.onValidate("admin", ...). Returns
 * field key to message; an empty object means the save is fine. An empty URL
 * is allowed so the plugin can be installed before it is configured.
 */
export function validateAdminSettings(
  values: Record<string, unknown>,
): Record<string, string> {
  const raw = values.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    normalizeBaseUrl(raw);
  } catch (err) {
    if (err instanceof QbtError) return { baseUrl: err.message };
    throw err;
  }
  return {};
}
