import type { ContentScriptContext } from '#imports';

export interface VideoIdStore {
  get: () => string | null;
  subscribe: (listener: () => void) => () => void;
}

export function videoIdFromUrl(href: string): string | null {
  const url = new URL(href);
  return url.pathname === '/watch' ? url.searchParams.get('v') : null;
}

/**
 * Current `?v=` of a /watch page. YouTube is an SPA: `yt-navigate-finish` is the
 * primary signal, WXT's `wxt:locationchange` (URL polling) the fallback.
 * The MAIN world reports which video the player has actually loaded; this URL
 * value hides the previous video's subtitles the moment navigation starts.
 */
export function createVideoIdStore(ctx: ContentScriptContext): VideoIdStore {
  let current = videoIdFromUrl(location.href);
  const listeners = new Set<() => void>();
  const update = () => {
    const next = videoIdFromUrl(location.href);
    if (next === current) return;
    current = next;
    for (const listener of listeners) listener();
  };
  ctx.addEventListener(document, 'yt-navigate-finish', update);
  ctx.addEventListener(window, 'wxt:locationchange', update);
  ctx.addEventListener(window, 'popstate', update);

  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
