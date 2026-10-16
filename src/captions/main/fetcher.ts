/**
 * MAIN world: fetches caption tracks with the PoToken of the player's own
 * timedtext request (docs/decisions/0002-captions-source.md).
 *
 * 1. Use a request the player already made for this video, if any.
 * 2. Otherwise wait briefly for one (users who keep captions on).
 * 3. Otherwise turn a Thai track on with the player API while native captions
 *    are hidden, take the PoToken from the request that follows, then restore
 *    the user's caption state: the previous track (normally "off") and both
 *    caption keys in youtube.com localStorage, byte for byte.
 * 4. Fetch every requested track ourselves with that PoToken.
 *
 * Live findings this relies on (docs/spikes.md §1): the PoToken is bound to the
 * video and works for any of its tracks, formats and `tlang`; the client
 * parameters (`c`, `cver`, …) must travel with it; on a fresh page the player's
 * first request is aborted by the player itself and a second one follows.
 */
import type { FetchResult } from '../bridge';
import { buildTrackUrl, sessionParams } from '../timedtext-url';
import type { TrackInfo, TrackRef } from '../types';
import { isUsable, type ObservedRequest, type TimedtextLog } from './observer';
import { readVideoInfo, trackBaseUrls, videoIdOf, type PlayerApi } from './player';

/** Written by the player when captions are toggled; restored after a forced load. */
export const CAPTION_STORAGE_KEYS = [
  'yt-player-caption-sticky-language',
  'yt-player-caption-persistence',
] as const;

export const TIMING = {
  /** Wait this long after the player reports a video for its own caption request. */
  naturalWaitMs: 1500,
  /** Shorter wait once a forced load was needed in this tab: the user keeps captions off. */
  naturalWaitAfterForceMs: 400,
  /** Max wait for a player request that is already in flight. */
  inFlightWaitMs: 3000,
  /** Max wait for the request that a forced track switch triggers. */
  forcedWaitMs: 5000,
  /**
   * Right after an SPA navigation the player can briefly report the previous
   * video again (seen live); wait this long for it to settle on the requested one.
   */
  playerSettleMs: 3000,
  playerPollMs: 100,
  /** Pre-roll ads: the forced switch waits until the ad is over, up to this long. */
  adWaitMs: 120_000,
  adPollMs: 250,
  /** An empty 200 is retried this many times. */
  emptyRetries: 2,
  retryDelayMs: 400,
};

export interface FetcherDeps {
  log: TimedtextLog;
  player: () => PlayerApi | null;
  /** `v` of the page URL: when it no longer names the video, the request is stale. */
  pageVideoId: () => string | null;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** The page's original fetch, so our requests are not mistaken for the player's. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  origin: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  isAdShowing: () => boolean;
  setNativeCaptionsHidden: (hidden: boolean) => void;
  timing?: Partial<typeof TIMING>;
}

type StorageSnapshot = Map<string, string | null>;

function isTrackObject(value: unknown): value is { languageCode: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { languageCode?: unknown }).languageCode === 'string'
  );
}

export class CaptionFetcher {
  private readonly timing: typeof TIMING;
  private readonly seenAt = new Map<string, number>();
  private readonly sessions = new Map<string, Promise<URL | null>>();
  private forcedBefore = false;

  constructor(private readonly deps: FetcherDeps) {
    this.timing = { ...TIMING, ...deps.timing };
  }

  /** The player reported this video: starts the natural-request wait. */
  noteVideo(videoId: string): void {
    if (!this.seenAt.has(videoId)) this.seenAt.set(videoId, this.deps.now());
  }

  async fetchTracks(videoId: string, refs: readonly TrackRef[]): Promise<FetchResult[]> {
    const response = await this.responseFor(videoId);
    if (response === null) return refs.map((ref) => ({ ref, ok: false, error: 'stale-video' }));
    const baseUrls = trackBaseUrls(response);
    const tracks = readVideoInfo(response)?.tracks ?? [];
    return Promise.all(refs.map((ref) => this.fetchOne(videoId, ref, baseUrls, tracks)));
  }

  private async fetchOne(
    videoId: string,
    ref: TrackRef,
    baseUrls: Map<string, string>,
    tracks: readonly TrackInfo[],
  ): Promise<FetchResult> {
    const base = baseUrls.get(ref.vssId);
    const track = tracks.find((candidate) => candidate.vssId === ref.vssId);
    if (!base || !track) return { ref, ok: false, error: 'unknown-track' };

    const captured = await this.session(videoId);
    // After the wait: the player's own request for this very track may have completed meanwhile.
    const reused = this.reusable(videoId, track, ref.tlang);
    if (reused) return { ref, ok: true, body: reused.body };
    if (!captured) return { ref, ok: false, error: 'no-pot' };
    const baseUrl = new URL(base, this.deps.origin);
    const url = buildTrackUrl(baseUrl, sessionParams(captured, baseUrl), ref.tlang);

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.deps.fetch(url, { credentials: 'include' });
      } catch {
        return { ref, ok: false, error: 'network' };
      }
      if (!response.ok) return { ref, ok: false, error: 'http' };
      const body = await response.text();
      if (body.trim() !== '') return { ref, ok: true, body };
      if (attempt >= this.timing.emptyRetries) return { ref, ok: false, error: 'empty' };
      await this.deps.sleep(this.timing.retryDelayMs * (attempt + 1));
    }
  }

  /** The player response for `videoId`, or null once the page has moved on or the wait ran out. */
  private async responseFor(videoId: string): Promise<unknown> {
    const deadline = this.deps.now() + this.timing.playerSettleMs;
    for (;;) {
      const response = this.deps.player()?.getPlayerResponse?.();
      if (videoIdOf(response) === videoId) return response;
      if (this.deps.pageVideoId() !== videoId || this.deps.now() >= deadline) return null;
      await this.deps.sleep(this.timing.playerPollMs);
    }
  }

  /** The player already fetched exactly this track as json3. */
  private reusable(videoId: string, track: TrackInfo, tlang?: string): ObservedRequest | undefined {
    return this.deps.log
      .forVideo(videoId)
      .findLast(
        (request) =>
          isUsable(request) &&
          request.fmt === 'json3' &&
          request.lang === track.languageCode &&
          request.kind === track.kind &&
          (request.tlang ?? undefined) === tlang,
      );
  }

  /** URL of a request whose PoToken works for this video; one acquisition per video at a time. */
  private session(videoId: string): Promise<URL | null> {
    let pending = this.sessions.get(videoId);
    if (!pending) {
      pending = this.acquire(videoId).then((url) => {
        if (!url) this.sessions.delete(videoId);
        return url;
      });
      this.sessions.set(videoId, pending);
    }
    return pending;
  }

  private newestUsable(videoId: string): ObservedRequest | undefined {
    return this.deps.log.forVideo(videoId).findLast(isUsable);
  }

  private async waitForUsable(
    videoId: string,
    deadline: number,
  ): Promise<ObservedRequest | undefined> {
    for (;;) {
      const found = this.newestUsable(videoId);
      if (found) return found;
      const left = deadline - this.deps.now();
      if (left <= 0) return undefined;
      await this.deps.log.changed(left);
    }
  }

  private async acquire(videoId: string): Promise<URL | null> {
    const { now } = this.deps;
    const seen = this.seenAt.get(videoId) ?? now();
    const wait = this.forcedBefore
      ? this.timing.naturalWaitAfterForceMs
      : this.timing.naturalWaitMs;
    const inFlight = this.deps.log
      .forVideo(videoId)
      .some((request) => request.hasPot && !request.settled);
    const deadline = Math.max(seen + wait, inFlight ? now() + this.timing.inFlightWaitMs : 0);
    const natural = await this.waitForUsable(videoId, deadline);
    if (natural) {
      this.forcedBefore = false;
      return natural.url;
    }
    return (await this.force(videoId))?.url ?? null;
  }

  private async force(videoId: string): Promise<ObservedRequest | undefined> {
    const { now, sleep } = this.deps;
    const adDeadline = now() + this.timing.adWaitMs;
    while (this.deps.isAdShowing() && now() < adDeadline) await sleep(this.timing.adPollMs);

    const player = this.deps.player();
    if (!player?.setOption || (await this.responseFor(videoId)) === null) return undefined;

    const snapshot = this.snapshotStorage();
    let previousTrack: unknown;
    try {
      previousTrack = player.getOption?.('captions', 'track');
    } catch {
      previousTrack = undefined;
    }
    this.deps.setNativeCaptionsHidden(true);
    try {
      player.loadModule?.('captions');
      player.setOption('captions', 'track', { languageCode: 'th' });
      return await this.waitForUsable(videoId, now() + this.timing.forcedWaitMs);
    } catch {
      return undefined;
    } finally {
      try {
        player.setOption('captions', 'track', isTrackObject(previousTrack) ? previousTrack : {});
      } catch {
        // The player is gone; nothing to restore there.
      }
      this.restoreStorage(snapshot);
      this.deps.setNativeCaptionsHidden(false);
      this.forcedBefore = true;
    }
  }

  private snapshotStorage(): StorageSnapshot {
    return new Map(CAPTION_STORAGE_KEYS.map((key) => [key, this.deps.storage.getItem(key)]));
  }

  private restoreStorage(snapshot: StorageSnapshot): void {
    for (const [key, value] of snapshot) {
      if (this.deps.storage.getItem(key) === value) continue;
      if (value === null) this.deps.storage.removeItem(key);
      else this.deps.storage.setItem(key, value);
    }
  }
}
