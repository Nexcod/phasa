/**
 * MAIN-world entry: wires the timedtext observer, the video watcher and the
 * fetcher to the bridge. Holds no user data and uses no extension APIs.
 */
import {
  envelope,
  openEnvelope,
  parseToMain,
  type ToIsolatedMessage,
  type ToMainMessage,
} from '../bridge';
import type { VideoInfo } from '../types';
import { CaptionFetcher } from './fetcher';
import { TimedtextLog, installTimedtextObserver } from './observer';
import { getPlayer } from './player';
import { watchVideo, watchedVideoId } from './watcher';

const FORCE_HIDE_STYLE_ID = 'phasa-force-hide-native-captions';

function setNativeCaptionsHidden(doc: Document, hidden: boolean): void {
  const existing = doc.getElementById(FORCE_HIDE_STYLE_ID);
  if (!hidden) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const style = doc.createElement('style');
  style.id = FORCE_HIDE_STYLE_ID;
  style.textContent = '.ytp-caption-window-container { display: none !important; }';
  // `head` can still be missing at document_start.
  ((doc.head as HTMLHeadElement | null) ?? doc.documentElement).append(style);
}

export function startMainWorld(win: Window & typeof globalThis): void {
  const doc = win.document;
  const log = new TimedtextLog(win.location.origin);
  const { nativeFetch } = installTimedtextObserver(win, log);
  const player = () => getPlayer(doc);

  const fetcher = new CaptionFetcher({
    log,
    player,
    pageVideoId: () => watchedVideoId(win.location.href),
    storage: win.localStorage,
    fetch: nativeFetch,
    origin: win.location.origin,
    now: () => win.performance.now(),
    sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
    isAdShowing: () =>
      doc.getElementById('movie_player')?.classList.contains('ad-showing') ?? false,
    setNativeCaptionsHidden: (hidden) => setNativeCaptionsHidden(doc, hidden),
  });

  let nonce: string | null = null;
  let video: VideoInfo | null = null;
  const post = (message: ToIsolatedMessage) => {
    if (nonce) win.postMessage(envelope('isolated', nonce, message), win.location.origin);
  };

  const handle = (message: ToMainMessage) => {
    if (message.type === 'hello') {
      post({ type: 'video', video });
      return;
    }
    const { requestId, videoId, refs } = message;
    void fetcher
      .fetchTracks(videoId, refs)
      .then((results) => post({ type: 'fetched', requestId, videoId, results }));
  };

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== win) return;
    const opened = openEnvelope(event.data, 'main');
    const message = opened && parseToMain(opened.message);
    if (!opened || !message) return;
    // The latest hello wins: a reloaded isolated script announces a new nonce.
    if (message.type === 'hello') nonce = opened.nonce;
    else if (opened.nonce !== nonce) return;
    handle(message);
  });

  // The player element appears after document_start; the watcher polls for it.
  watchVideo({
    win,
    doc,
    player,
    onChange(next) {
      video = next;
      if (next) fetcher.noteVideo(next.videoId);
      post({ type: 'video', video: next });
    },
  });

  doc.documentElement.dataset.phasaMain = 'ready';
}
