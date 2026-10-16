/**
 * A stand-in for youtube.com watch pages: real `<video>` playback (a blank
 * WebM), a player element with the API surface Phasa uses, and a timedtext
 * endpoint that, like the real one, returns an empty body without a PoToken.
 * Behaviour follows what the captions spike observed (docs/spikes.md §1).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Route } from '@playwright/test';
import { processTrack } from '../../src/captions/process';

const FIXTURES = join(import.meta.dirname, '../fixtures');
const caption = (name: string) => readFileSync(join(FIXTURES, 'captions', name), 'utf8');
const MEDIA = readFileSync(join(FIXTURES, 'media/blank-120s.webm'));

interface FakeTrack {
  vssId: string;
  languageCode: string;
  kind?: 'asr';
  /** timedtext bodies by `tlang` ('' = the track itself). */
  bodies: Record<string, string>;
}

interface FakeVideo {
  videoId: string;
  title: string;
  tracks: FakeTrack[];
}

const THAI_ASR = caption('iH31BMKBEdU.a.th.json3.json');
const THAI_ASR_EN = caption('iH31BMKBEdU.a.th.tlang-en.json3.json');

export const FAKE_VIDEOS: Record<string, FakeVideo> = {
  /** Thai auto-generated only; English comes from YouTube's translation (tlang=en). */
  iH31BMKBEdU: {
    videoId: 'iH31BMKBEdU',
    title: 'ฝรั่งคิดยังไงกับภาษาไทย? เปิดใจเผยความคิดลึกๆ',
    tracks: [
      { vssId: 'a.th', languageCode: 'th', kind: 'asr', bodies: { '': THAI_ASR, en: THAI_ASR_EN } },
    ],
  },
  /** English manual + Thai auto-generated: the English line comes from the manual track. */
  uYEW8BeJ0zY: {
    videoId: 'uYEW8BeJ0zY',
    title: 'STUDY TIPS',
    tracks: [
      { vssId: '.en', languageCode: 'en', bodies: { '': caption('uYEW8BeJ0zY.en.json3.json') } },
      { vssId: 'a.th', languageCode: 'th', kind: 'asr', bodies: { '': THAI_ASR, en: THAI_ASR_EN } },
    ],
  },
  /** No Thai track at all. */
  jNQXAC9IVRw: {
    videoId: 'jNQXAC9IVRw',
    title: 'Me at the zoo',
    tracks: [
      { vssId: '.en', languageCode: 'en', bodies: { '': caption('uYEW8BeJ0zY.en.json3.json') } },
    ],
  },
};

/** The Thai fixture as the extension shows it. */
export const THAI_CUES = processTrack({
  videoId: 'iH31BMKBEdU',
  ref: { vssId: 'a.th' },
  languageCode: 'th',
  kind: 'asr',
  body: THAI_ASR,
  fetchedAt: 0,
}).cues;

export const PRESET_STICKY_LANGUAGE = '{"data":"en","expiration":1,"creation":1}';

/** The fake player, injected as a page (MAIN-world) script. */
function playerScript(captionsOn: boolean): string {
  const videos = Object.fromEntries(
    Object.values(FAKE_VIDEOS).map((video) => [
      video.videoId,
      {
        ...video,
        tracks: video.tracks.map((track) => ({
          vssId: track.vssId,
          languageCode: track.languageCode,
          kind: track.kind,
        })),
      },
    ]),
  );
  return `
(() => {
  const VIDEOS = ${JSON.stringify(videos)};
  // Simulates a user whose YouTube remembers English captions but keeps them off.
  if (!sessionStorage.getItem('fake-yt-init')) {
    sessionStorage.setItem('fake-yt-init', '1');
    localStorage.setItem('yt-player-caption-sticky-language', ${JSON.stringify(PRESET_STICKY_LANGUAGE)});
    localStorage.removeItem('yt-player-caption-persistence');
  }
  const state = {
    videoId: new URLSearchParams(location.search).get('v'),
    track: {},
    captionsOn: ${captionsOn},
    setOptionCalls: [],
    pageKeys: { KeyT: 0, Space: 0 },
    loaded: false,
  };
  window.__fakeYt = state;
  const player = document.getElementById('movie_player');
  const video = document.querySelector('video');
  const baseUrl = (v, t) =>
    '/api/timedtext?v=' + v + '&ei=x&signature=sig&key=yt8' + (t.kind === 'asr' ? '&kind=asr' : '') + '&lang=' + t.languageCode;
  const response = () => {
    const v = VIDEOS[state.videoId];
    if (!v || !state.loaded) return null;
    return {
      videoDetails: { videoId: v.videoId, title: v.title, author: 'Fake channel', lengthSeconds: '120' },
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: v.tracks.map((t) => ({
            baseUrl: baseUrl(v.videoId, t),
            vssId: t.vssId,
            languageCode: t.languageCode,
            kind: t.kind,
            name: { simpleText: t.languageCode },
            isTranslatable: true,
          })),
        },
      },
    };
  };
  // Like the real player: a fresh page aborts its first request and sends a second one.
  const requestCaptions = () => {
    const v = VIDEOS[state.videoId];
    const t = v.tracks.find((track) => track.languageCode === 'th') || v.tracks[0];
    const url = baseUrl(v.videoId, t) + '&potc=1&pot=FAKEPOT&c=WEB&cver=2.20261015&fmt=json3';
    const first = new XMLHttpRequest();
    first.open('GET', url);
    first.send();
    first.abort();
    const second = new XMLHttpRequest();
    second.open('GET', url);
    second.send();
  };
  player.getPlayerResponse = response;
  player.loadModule = () => {};
  player.getOption = (module, option) => (option === 'track' ? state.track : undefined);
  player.setOption = (module, option, value) => {
    state.setOptionCalls.push(value);
    state.track = value;
    localStorage.setItem('yt-player-caption-sticky-language', JSON.stringify({ data: value.languageCode || 'th', creation: Date.now() }));
    localStorage.setItem('yt-player-caption-persistence', JSON.stringify({ data: String(!!value.languageCode), creation: Date.now() }));
    if (value.languageCode) requestCaptions();
  };
  const boot = () => {
    state.loaded = true;
    if (state.captionsOn) requestCaptions();
  };
  setTimeout(boot, 300);
  video.src = '/fake-media/blank.webm';

  // SPA navigation like YouTube's: URL first, the player follows.
  window.__navigate = (v) => {
    history.pushState({}, '', '/watch?v=' + v);
    document.dispatchEvent(new CustomEvent('yt-navigate-start'));
    state.loaded = false;
    state.videoId = v;
    state.track = {};
    video.currentTime = 0;
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent('yt-navigate-finish'));
      boot();
    }, 300);
  };
  document.querySelectorAll('[data-navigate]').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.__navigate(link.dataset.navigate);
    }),
  );
  // YouTube's own shortcuts: T = theater mode, Space = play/pause. Count what reaches the page.
  document.addEventListener('keydown', (event) => {
    if (event.code in state.pageKeys) state.pageKeys[event.code]++;
  });
  document.getElementById('fullscreen').addEventListener('click', () =>
    document.getElementById('player-container').requestFullscreen(),
  );
})();`;
}

export function fakeWatchPage(options: { captionsOn?: boolean } = {}): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Fake watch page</title></head>
<body style="margin:0;background:#fff">
  <div id="player-container" style="width:854px;height:480px">
    <div id="movie_player" class="html5-video-player ytp-autohide" style="position:relative;width:100%;height:100%;background:#000;overflow:hidden">
      <div class="html5-video-container"><video class="html5-main-video" muted playsinline style="width:100%;height:100%"></video></div>
      <div class="ytp-caption-window-container" id="native-captions">NATIVE CAPTIONS</div>
    </div>
  </div>
  <a href="/watch?v=uYEW8BeJ0zY" data-navigate="uYEW8BeJ0zY" id="next">next video</a>
  <a href="/watch?v=jNQXAC9IVRw" data-navigate="jNQXAC9IVRw" id="no-thai">video without Thai</a>
  <button id="fullscreen">fullscreen</button>
  <input id="search" placeholder="Search">
  <script>${playerScript(options.captionsOn ?? false)}</script>
</body></html>`;
}

export interface TimedtextLogEntry {
  url: URL;
  hasPot: boolean;
}

function fulfillMedia(route: Route): Promise<void> {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
  if (!range) {
    return route.fulfill({
      status: 200,
      contentType: 'video/webm',
      headers: { 'accept-ranges': 'bytes' },
      body: MEDIA,
    });
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), MEDIA.length - 1) : MEDIA.length - 1;
  return route.fulfill({
    status: 206,
    contentType: 'video/webm',
    headers: {
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${MEDIA.length}`,
    },
    body: MEDIA.subarray(start, end + 1),
  });
}

/** Routes www.youtube.com to the fake; returns the log of timedtext requests. */
export async function routeFakeYouTube(
  context: BrowserContext,
  options: { captionsOn?: boolean } = {},
): Promise<TimedtextLogEntry[]> {
  const log: TimedtextLogEntry[] = [];
  await context.route('https://www.youtube.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fake-media/blank.webm') return fulfillMedia(route);
    if (url.pathname === '/api/timedtext') {
      const params = url.searchParams;
      const hasPot = params.get('pot') === 'FAKEPOT' && params.get('c') === 'WEB';
      log.push({ url, hasPot });
      const video = FAKE_VIDEOS[params.get('v') ?? ''];
      const track = video?.tracks.find(
        (t) =>
          t.languageCode === params.get('lang') && (t.kind ?? '') === (params.get('kind') ?? ''),
      );
      // Real timedtext answers 200 with an empty body when the PoToken is missing.
      const body = hasPot ? (track?.bodies[params.get('tlang') ?? ''] ?? '') : '';
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    return route.fulfill({ contentType: 'text/html', body: fakeWatchPage(options) });
  });
  return log;
}
