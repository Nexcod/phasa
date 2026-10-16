/**
 * Serves the side panel's direct connection to this tab (src/messaging/panel.ts):
 * the transcript and the playing cue go out, seeks and settings come in.
 */
import { browser, type Browser } from 'wxt/browser';
import {
  PANEL_PORT_NAME,
  parsePanelToTab,
  type PanelSession,
  type TabToPanel,
} from '../messaging/panel';
import type { ContentController, ContentState } from './controller';

export function toPanelSession(state: ContentState): PanelSession {
  const { urlVideoId, session } = state;
  if (!urlVideoId) return { status: 'idle' };
  if (session.status === 'idle' || session.video.videoId !== urlVideoId) {
    return { status: 'loading', video: { videoId: urlVideoId, title: '', channel: '' } };
  }
  const video = {
    videoId: session.video.videoId,
    title: session.video.title,
    channel: session.video.channel,
  };
  switch (session.status) {
    case 'loading':
    case 'no-thai':
      return { status: session.status, video };
    case 'error':
      return { status: 'error', video, error: session.error };
    case 'ready': {
      const lines = session.english.status === 'ready' ? session.english.lines : [];
      return {
        status: 'ready',
        video,
        kind: session.thai.kind,
        cues: session.thai.cues.map((cue, i) => {
          const translation = lines[i];
          return translation
            ? { startMs: cue.startMs, endMs: cue.endMs, text: cue.text, translation }
            : { startMs: cue.startMs, endMs: cue.endMs, text: cue.text };
        }),
      };
    }
  }
}

export function servePanel(controller: ContentController): () => void {
  const ports = new Set<Browser.runtime.Port>();
  const send = (port: Browser.runtime.Port, message: TabToPanel) => {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  };
  const sessionMessage = (): TabToPanel => {
    const state = controller.store.get();
    return { type: 'session', session: toPanelSession(state), activeIndex: state.activeIndex };
  };

  const onConnect = (port: Browser.runtime.Port) => {
    if (port.name !== PANEL_PORT_NAME) return;
    // Only our own extension pages may drive the player.
    if (port.sender?.id !== browser.runtime.id) {
      port.disconnect();
      return;
    }
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((raw: unknown) => {
      const message = parsePanelToTab(raw);
      if (message?.type === 'seek') controller.seekToIndex(message.index);
      else if (message?.type === 'retry') controller.retry();
      else if (message?.type === 'settings') controller.applySettings(message.settings);
    });
    send(port, sessionMessage());
  };
  browser.runtime.onConnect.addListener(onConnect);

  let last = controller.store.get();
  const unsubscribe = controller.store.subscribe(() => {
    const state = controller.store.get();
    const changed =
      state.session !== last.session ||
      state.urlVideoId !== last.urlVideoId ||
      state.player.adShowing !== last.player.adShowing;
    const moved = state.activeIndex !== last.activeIndex;
    last = state;
    if (ports.size === 0 || (!changed && !moved)) return;
    const message: TabToPanel = changed
      ? sessionMessage()
      : { type: 'active', index: state.activeIndex };
    for (const port of ports) send(port, message);
  });

  return () => {
    unsubscribe();
    browser.runtime.onConnect.removeListener(onConnect);
    for (const port of ports) port.disconnect();
    ports.clear();
  };
}
