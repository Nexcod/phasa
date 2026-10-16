import { useCallback, useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import {
  PANEL_PORT_NAME,
  type PanelSession,
  type PanelToTab,
  type TabToPanel,
} from '@/src/messaging/panel';

export interface ActiveTab {
  tabId: number;
  /** Only known for hosts we have permission for (youtube.com). */
  url: string | undefined;
}

/**
 * The tab the panel shows: the active tab of this window. `?tab=<id>` pins a
 * tab instead (used by e2e tests, where the panel page itself is a tab).
 */
export function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);

  useEffect(() => {
    const pinned = Number(new URLSearchParams(location.search).get('tab'));
    let active = true;
    const refresh = () => {
      const query =
        Number.isInteger(pinned) && pinned > 0
          ? browser.tabs.get(pinned).then((found) => [found])
          : browser.tabs.query({ active: true, currentWindow: true });
      query.then(
        ([found]) => {
          if (active) setTab(found?.id === undefined ? null : { tabId: found.id, url: found.url });
        },
        () => {
          if (active) setTab(null);
        },
      );
    };
    const onUpdated = (_tabId: number, change: Browser.tabs.OnUpdatedInfo) => {
      if (change.url !== undefined || change.status === 'complete') refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    refresh();
    return () => {
      active = false;
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tab;
}

export function isWatchUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'www.youtube.com' && parsed.pathname === '/watch';
  } catch {
    return false;
  }
}

export type TabConnection =
  | { state: 'none' }
  | { state: 'connecting' }
  /** A YouTube tab without our content script: opened before Phasa was installed or updated. */
  | { state: 'unreachable' }
  | { state: 'connected'; session: PanelSession; activeIndex: number };

const RECONNECT_MS = 1000;
const MAX_RECONNECTS = 5;

/** Direct port to the tab's content script (src/messaging/panel.ts). */
export function useTabSession(tab: ActiveTab | null): {
  connection: TabConnection;
  send: (message: PanelToTab) => void;
} {
  const [connection, setConnection] = useState<TabConnection>({ state: 'none' });
  const portRef = useRef<Browser.runtime.Port | null>(null);
  /** Bumped to reconnect. */
  const [attempt, setAttempt] = useState(0);
  /** Connections in a row that closed without a word from the tab. */
  const failures = useRef(0);
  const tabId = tab?.tabId;
  const onYouTube = tab?.url?.startsWith('https://www.youtube.com/') ?? false;

  useEffect(() => {
    failures.current = 0;
  }, [tabId]);

  useEffect(() => {
    if (tabId === undefined || !onYouTube) {
      setConnection({ state: 'none' });
      return;
    }
    let disposed = false;
    let heard = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setConnection({ state: 'connecting' });
    const port = browser.tabs.connect(tabId, { name: PANEL_PORT_NAME, frameId: 0 });
    portRef.current = port;
    port.onMessage.addListener((raw: unknown) => {
      heard = true;
      failures.current = 0;
      const message = raw as TabToPanel;
      if (message.type === 'session') {
        setConnection({
          state: 'connected',
          session: message.session,
          activeIndex: message.activeIndex,
        });
      } else {
        setConnection((current) =>
          current.state === 'connected' ? { ...current, activeIndex: message.index } : current,
        );
      }
    });
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it handled: "Receiving end does not exist" without a content script.
      const reason = browser.runtime.lastError?.message;
      if (disposed) return;
      portRef.current = null;
      if (!heard && ++failures.current > MAX_RECONNECTS) {
        console.debug('[phasa] no content script in tab', tabId, reason);
        setConnection({ state: 'unreachable' });
        return;
      }
      // The tab reloaded or is still loading: try again shortly.
      setConnection({ state: 'connecting' });
      retry = setTimeout(() => setAttempt((n) => n + 1), RECONNECT_MS);
    });
    return () => {
      disposed = true;
      clearTimeout(retry);
      portRef.current = null;
      port.disconnect();
    };
  }, [tabId, onYouTube, attempt]);

  const send = useCallback((message: PanelToTab) => {
    try {
      portRef.current?.postMessage(message);
    } catch {
      // Port closed in between; the reconnect loop picks it up.
    }
  }, []);

  return { connection, send };
}
