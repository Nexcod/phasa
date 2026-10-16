/**
 * MAIN world: reports the video the player has loaded for the current
 * `/watch?v=` URL. YouTube is an SPA: the URL changes first and the player
 * follows ~0.1–1 s later, so a video is reported only once both agree
 * (docs/plan.md §4.1 step 1).
 */
import type { VideoInfo } from '../types';
import { readVideoInfo, videoIdOf, type PlayerApi } from './player';

const NAVIGATION_EVENTS = ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated'];
/** Poll fast while the URL names a video the player hasn't loaded yet. */
const PENDING_POLL_MS = 100;
const IDLE_POLL_MS = 1000;

export function watchedVideoId(href: string): string | null {
  const url = new URL(href);
  return url.pathname === '/watch' ? url.searchParams.get('v') : null;
}

export interface VideoWatcher {
  current(): VideoInfo | null;
  stop(): void;
}

export function watchVideo(options: {
  win: Window;
  doc: Document;
  player: () => PlayerApi | null;
  onChange: (video: VideoInfo | null) => void;
}): VideoWatcher {
  const { win, doc, player, onChange } = options;
  let current: VideoInfo | null = null;
  let reported = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    clearTimeout(timer);
    const wanted = watchedVideoId(win.location.href);
    let next: VideoInfo | null = null;
    if (wanted) {
      const response = player()?.getPlayerResponse?.();
      if (videoIdOf(response) === wanted) next = readVideoInfo(response);
    }
    if (!reported || (next?.videoId ?? null) !== (current?.videoId ?? null)) {
      current = next;
      reported = true;
      onChange(next);
    }
    timer = setTimeout(check, wanted && !next ? PENDING_POLL_MS : IDLE_POLL_MS);
  };

  for (const type of NAVIGATION_EVENTS) doc.addEventListener(type, check);
  win.addEventListener('popstate', check);
  check();

  return {
    current: () => current,
    stop() {
      clearTimeout(timer);
      for (const type of NAVIGATION_EVENTS) doc.removeEventListener(type, check);
      win.removeEventListener('popstate', check);
    },
  };
}
