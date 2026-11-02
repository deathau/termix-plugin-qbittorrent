import { useCallback, useEffect, useState } from "react";
import {
  useTranslation,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import type { TorrentsBody, TorrentsOk } from "./torrents.js";

const POLL_MS = 3000;

/**
 * Polls the torrent list only while the tab is showing. The next request is
 * scheduled after the previous one finishes, so a slow qBittorrent never piles
 * up requests. `refresh` restarts the loop straight away.
 */
export function useTorrents(app: TermixApp, isVisible: boolean) {
  const { t } = useTranslation();
  const [data, setData] = useState<TorrentsOk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const { data: body } = await app.api.get<TorrentsBody>("/torrents");
        if (cancelled) return;
        if (body.ok === false) {
          // Keep showing the last good data, with the reason above it.
          setError(body.error.message);
        } else {
          setData(body);
          setError(null);
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

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, refresh, pollMs: POLL_MS };
}
