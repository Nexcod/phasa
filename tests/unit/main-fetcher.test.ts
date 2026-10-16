import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTION_STORAGE_KEYS, CaptionFetcher, TIMING } from '@/src/captions/main/fetcher';
import { TimedtextLog } from '@/src/captions/main/observer';
import { readVideoInfo, type PlayerApi } from '@/src/captions/main/player';
import { buildTrackUrl, sessionParams } from '@/src/captions/timedtext-url';

const ORIGIN = 'https://www.youtube.com';
const SIGNED =
  'ei=x&caps=asr&opi=1&exp=xpe&xoaf=5&hl=en&ip=0.0.0.0&ipbits=0&expire=9&sparams=ip&signature=sig&key=yt8';
const SESSION = 'potc=1&pot=POT123&fmt=json3&xorb=2&c=WEB&cver=2.20261015&cplayer=UNIPLAYER';

function baseUrl(videoId: string, lang: string, kind?: 'asr'): string {
  return `${ORIGIN}/api/timedtext?v=${videoId}&${SIGNED}${kind ? `&kind=${kind}` : ''}&lang=${lang}`;
}

function playerResponse(videoId: string) {
  return {
    videoDetails: { videoId, title: 'T', author: 'A', lengthSeconds: '60' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: baseUrl(videoId, 'th'),
            languageCode: 'th',
            vssId: '.th',
            name: { simpleText: 'Thai' },
            isTranslatable: true,
          },
          {
            baseUrl: baseUrl(videoId, 'th', 'asr'),
            languageCode: 'th',
            kind: 'asr',
            vssId: 'a.th',
            name: { runs: [{ text: 'Thai (auto)' }] },
            isTranslatable: true,
          },
        ],
      },
    },
  };
}

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

/** Behaves like YouTube's player as observed live (docs/spikes.md §1). */
class FakePlayer implements PlayerApi {
  readonly calls: unknown[] = [];
  track: unknown = {};
  response: unknown;
  /** Delay before the second (successful) request completes. */
  responseDelayMs = 30;

  constructor(
    private readonly log: TimedtextLog,
    private readonly storage: MemoryStorage,
    videoId: string,
  ) {
    this.response = playerResponse(videoId);
  }

  getPlayerResponse = () => this.response;
  loadModule = (name: string) => void this.calls.push(['loadModule', name]);
  getOption = () => this.track;
  setOption = (_module: string, _option: string, value: unknown) => {
    this.calls.push(['setOption', value]);
    this.track = value;
    // The player persists the caption choice on every switch.
    this.storage.setItem('yt-player-caption-sticky-language', '{"data":"th","creation":2}');
    this.storage.setItem('yt-player-caption-persistence', '{"data":"true","creation":2}');
    if ((value as { languageCode?: string }).languageCode) this.requestCaptions();
  };

  requestCaptions(
    videoId = (this.response as { videoDetails: { videoId: string } }).videoDetails.videoId,
  ) {
    const url = `${baseUrl(videoId, 'th', 'asr')}&${SESSION}`;
    // Fresh page: the player aborts its first request and sends a second one.
    const first = this.log.add(url)!;
    this.log.settle(first, 0, '');
    const second = this.log.add(url)!;
    setTimeout(
      () => this.log.settle(second, 200, '{"events":[{"segs":[{"utf8":"player"}]}]}'),
      this.responseDelayMs,
    );
  }
}

function setup(videoId = 'VIDEO000001', options: { adShowing?: () => boolean } = {}) {
  const log = new TimedtextLog(ORIGIN);
  const storage = new MemoryStorage();
  const player = new FakePlayer(log, storage, videoId);
  const fetched: string[] = [];
  const hidden: boolean[] = [];
  let respond = (url: string): string =>
    `{"events":[],"url":"${new URL(url).searchParams.get('tlang') ?? ''}"}`;
  const page = { videoId };
  const fetcher = new CaptionFetcher({
    log,
    player: () => player,
    pageVideoId: () => page.videoId,
    storage,
    fetch: (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(respond(url), { status: 200 }));
    },
    origin: ORIGIN,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isAdShowing: options.adShowing ?? (() => false),
    setNativeCaptionsHidden: (value) => hidden.push(value),
  });
  return {
    log,
    storage,
    player,
    page,
    fetcher,
    fetched,
    hidden,
    setResponder: (fn: (url: string) => string) => (respond = fn),
  };
}

async function settle<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('timedtext URLs', () => {
  it('copies the PoToken and client params, never the track or format', () => {
    const captured = new URL(`${baseUrl('V', 'th', 'asr')}&${SESSION}&tlang=ru`);
    const base = new URL(baseUrl('V', 'en'));
    const params = sessionParams(captured, base);
    expect(Object.fromEntries(params)).toEqual({
      potc: '1',
      pot: 'POT123',
      xorb: '2',
      c: 'WEB',
      cver: '2.20261015',
      cplayer: 'UNIPLAYER',
    });
    const url = new URL(buildTrackUrl(base, params, 'en'));
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('kind')).toBeNull();
    expect(url.searchParams.get('fmt')).toBe('json3');
    expect(url.searchParams.get('tlang')).toBe('en');
    expect(url.searchParams.get('signature')).toBe('sig');
  });
});

describe('readVideoInfo', () => {
  it('reads details and tracks defensively', () => {
    expect(readVideoInfo(playerResponse('VIDEO000001'))).toEqual({
      videoId: 'VIDEO000001',
      title: 'T',
      channel: 'A',
      durationSec: 60,
      isLive: false,
      tracks: [
        { vssId: '.th', languageCode: 'th', kind: 'manual', name: 'Thai', isTranslatable: true },
        {
          vssId: 'a.th',
          languageCode: 'th',
          kind: 'asr',
          name: 'Thai (auto)',
          isTranslatable: true,
        },
      ],
    });
    expect(readVideoInfo(null)).toBeNull();
    expect(readVideoInfo({ videoDetails: { videoId: 'x' } })?.tracks).toEqual([]);
  });
});

describe('CaptionFetcher', () => {
  it('uses the request the player already made: no forced switch', async () => {
    const { fetcher, player, fetched } = setup();
    fetcher.noteVideo('VIDEO000001');
    player.requestCaptions();
    const results = await settle(
      fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }, { vssId: 'a.th', tlang: 'en' }]),
    );

    expect(player.calls).toEqual([]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(fetched).toHaveLength(2);
    for (const url of fetched.map((u) => new URL(u))) {
      expect(url.searchParams.get('pot')).toBe('POT123');
      expect(url.searchParams.get('c')).toBe('WEB');
      expect(url.searchParams.get('fmt')).toBe('json3');
    }
    expect(new URL(fetched[1]!).searchParams.get('tlang')).toBe('en');
  });

  it("reuses the player's own json3 body for the same track", async () => {
    const { fetcher, player, fetched } = setup();
    player.requestCaptions();
    const [result] = await settle(fetcher.fetchTracks('VIDEO000001', [{ vssId: 'a.th' }]));
    expect(result).toEqual({
      ref: { vssId: 'a.th' },
      ok: true,
      body: '{"events":[{"segs":[{"utf8":"player"}]}]}',
    });
    expect(fetched).toEqual([]);
  });

  it('forces a Thai track after the wait, then restores the caption state byte for byte', async () => {
    const { fetcher, player, storage, fetched, hidden } = setup();
    storage.setItem('yt-player-caption-sticky-language', '{"data":"en","creation":1}');
    // persistence key absent: must be absent again afterwards
    fetcher.noteVideo('VIDEO000001');
    const pending = fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]);

    await vi.advanceTimersByTimeAsync(TIMING.naturalWaitMs - 10);
    expect(player.calls).toEqual([]);
    const results = await settle(pending);

    expect(results[0]?.ok).toBe(true);
    expect(player.calls).toEqual([
      ['loadModule', 'captions'],
      ['setOption', { languageCode: 'th' }],
      ['setOption', {}],
    ]);
    expect(storage.getItem(CAPTION_STORAGE_KEYS[0])).toBe('{"data":"en","creation":1}');
    expect(storage.getItem(CAPTION_STORAGE_KEYS[1])).toBeNull();
    expect(hidden).toEqual([true, false]);
    expect(new URL(fetched[0]!).searchParams.get('pot')).toBe('POT123');
  });

  it('acquires the PoToken once for concurrent requests and waits less after a forced load', async () => {
    const { fetcher, player } = setup();
    fetcher.noteVideo('VIDEO000001');
    const both = Promise.all([
      fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]),
      fetcher.fetchTracks('VIDEO000001', [{ vssId: 'a.th', tlang: 'en' }]),
    ]);
    await settle(both);
    expect(player.calls.filter((call) => (call as unknown[])[0] === 'setOption')).toHaveLength(2);

    player.response = playerResponse('VIDEO000002');
    player.calls.length = 0;
    fetcher.noteVideo('VIDEO000002');
    const next = fetcher.fetchTracks('VIDEO000002', [{ vssId: '.th' }]);
    await vi.advanceTimersByTimeAsync(TIMING.naturalWaitAfterForceMs + 5);
    expect(player.calls[1]).toEqual(['setOption', { languageCode: 'th' }]);
    await settle(next);
  });

  it('waits for a pre-roll ad to end before switching tracks', async () => {
    let ad = true;
    const { fetcher, player } = setup('VIDEO000001', { adShowing: () => ad });
    fetcher.noteVideo('VIDEO000001');
    const pending = fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(player.calls).toEqual([]);
    ad = false;
    const results = await settle(pending);
    expect(results[0]?.ok).toBe(true);
    expect(player.calls).toHaveLength(3);
  });

  it('retries an empty body, then reports it', async () => {
    const { fetcher, player, fetched, setResponder } = setup();
    player.requestCaptions();
    let calls = 0;
    setResponder(() => (++calls < 3 ? '' : '{"events":[]}'));
    const [ok] = await settle(fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]));
    expect(ok?.ok).toBe(true);
    expect(fetched).toHaveLength(3);

    setResponder(() => '');
    const [empty] = await settle(
      fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th', tlang: 'en' }]),
    );
    expect(empty).toEqual({ ref: { vssId: '.th', tlang: 'en' }, ok: false, error: 'empty' });
  });

  it('reports no-pot when even a forced switch yields nothing (automation, logged-out edge cases)', async () => {
    const { fetcher, player, storage } = setup();
    player.setOption = (_m, _o, value) => {
      player.calls.push(['setOption', value]);
      storage.setItem('yt-player-caption-persistence', 'changed');
    };
    const [result] = await settle(fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]), 20_000);
    expect(result).toMatchObject({ ok: false, error: 'no-pot' });
    expect(storage.getItem('yt-player-caption-persistence')).toBeNull();
  });

  it('waits for the player to catch up with an SPA navigation', async () => {
    const { fetcher, player, page } = setup();
    const previous = player.response;
    page.videoId = 'VIDEO000002';
    // Live: right after switching, the player can still report the previous video.
    setTimeout(() => (player.response = playerResponse('VIDEO000002')), 250);
    player.response = previous;
    const pending = fetcher.fetchTracks('VIDEO000002', [{ vssId: '.th' }]);
    await vi.advanceTimersByTimeAsync(300);
    player.requestCaptions('VIDEO000002');
    const [result] = await settle(pending);
    expect(result?.ok).toBe(true);
  });

  it('refuses stale videos and unknown tracks', async () => {
    const { fetcher, player, page } = setup();
    player.requestCaptions();
    page.videoId = 'OTHERVIDEO1';
    expect(await settle(fetcher.fetchTracks('OTHERVIDEO1', [{ vssId: '.th' }]))).toEqual([
      { ref: { vssId: '.th' }, ok: false, error: 'stale-video' },
    ]);
    page.videoId = 'VIDEO000001';
    expect(await settle(fetcher.fetchTracks('VIDEO000001', [{ vssId: '.xx' }]))).toEqual([
      { ref: { vssId: '.xx' }, ok: false, error: 'unknown-track' },
    ]);
  });

  it('ignores requests of other videos (the player prefetches)', async () => {
    const { fetcher, player } = setup();
    player.requestCaptions('PREFETCHED1');
    fetcher.noteVideo('VIDEO000001');
    const pending = fetcher.fetchTracks('VIDEO000001', [{ vssId: '.th' }]);
    await settle(pending);
    expect(player.calls).toHaveLength(3); // had to force: the prefetch does not count
  });
});
