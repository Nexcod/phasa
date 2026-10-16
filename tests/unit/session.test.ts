import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { FetchResult } from '@/src/captions/bridge';
import { processTrack } from '@/src/captions/process';
import type { ProcessedTrack, TrackRef, VideoInfo } from '@/src/captions/types';
import {
  createSessionManager,
  loadSession,
  type SessionDeps,
  type SessionState,
} from '@/src/content/session';
import { RpcFailure } from '@/src/messaging/protocol';

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, '../fixtures/captions', name), 'utf8');
}

const BODIES: Record<string, string> = {
  'a.th': fixture('iH31BMKBEdU.a.th.json3.json'),
  'a.th>en': fixture('iH31BMKBEdU.a.th.tlang-en.json3.json'),
};

const VIDEO: VideoInfo = {
  videoId: 'iH31BMKBEdU',
  title: 'T',
  channel: 'C',
  durationSec: 1008,
  isLive: false,
  tracks: [{ vssId: 'a.th', languageCode: 'th', kind: 'asr', name: 'Thai', isTranslatable: true }],
};

const key = (ref: TrackRef) => (ref.tlang ? `${ref.vssId}>${ref.tlang}` : ref.vssId);

function fakeDeps(
  options: {
    cache?: ProcessedTrack[];
    fail?: FetchResult['ok'] extends true ? never : string;
  } = {},
) {
  const cache = new Map((options.cache ?? []).map((track) => [track.key, track]));
  const fetchTracks = vi.fn((_videoId: string, refs: TrackRef[]): Promise<FetchResult[]> =>
    Promise.resolve(
      refs.map((ref) =>
        options.fail
          ? { ref, ok: false as const, error: options.fail as 'no-pot' }
          : { ref, ok: true as const, body: BODIES[key(ref)] ?? '' },
      ),
    ),
  );
  const request = vi.fn((method: string, params: unknown) => {
    if (method === 'captions/get') return Promise.resolve({ tracks: [...cache.values()] });
    if (method === 'captions/process') {
      const { items } = params as {
        items: { ref: TrackRef; languageCode: string; kind: 'asr'; body: string }[];
      };
      const tracks = items.map((item) =>
        processTrack({ videoId: VIDEO.videoId, ...item, fetchedAt: 0 }),
      );
      for (const track of tracks) cache.set(track.key, track);
      return Promise.resolve({ tracks, failed: [] });
    }
    return Promise.reject(new Error(`unexpected ${method}`));
  });
  const deps = {
    bridge: { fetchTracks },
    client: { request },
    now: () => 0,
  } as unknown as SessionDeps;
  return { deps, fetchTracks, request, cache };
}

describe('loadSession', () => {
  it('loads Thai, then the aligned English line', async () => {
    const { deps, fetchTracks } = fakeDeps();
    const states: SessionState[] = [];
    await loadSession(VIDEO, deps, new AbortController().signal, (state) => states.push(state));

    expect(
      states.map((s) => (s.status === 'ready' ? `ready/${s.english.status}` : s.status)),
    ).toEqual(['loading', 'ready/loading', 'ready/ready']);
    const last = states.at(-1);
    if (last?.status !== 'ready' || last.english.status !== 'ready') throw new Error('not ready');
    expect(last.thai.key).toBe('a.th');
    expect(last.english.lines[1]).toBe("Hello, I have something I'd like to discuss today. To");
    expect(fetchTracks.mock.calls.map((call) => call[1])).toEqual([
      [{ vssId: 'a.th' }],
      [{ vssId: 'a.th', tlang: 'en' }],
    ]);
  });

  it('opens a cached video without touching the player', async () => {
    const first = fakeDeps();
    await loadSession(VIDEO, first.deps, new AbortController().signal, () => undefined);
    const second = fakeDeps({ cache: [...first.cache.values()] });
    const states: SessionState[] = [];
    await loadSession(VIDEO, second.deps, new AbortController().signal, (state) =>
      states.push(state),
    );
    expect(second.fetchTracks).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ status: 'ready', english: { status: 'ready' } });
  });

  it('says "No Thai subtitles" from the track list alone', async () => {
    const { deps, request } = fakeDeps();
    const states: SessionState[] = [];
    const video = { ...VIDEO, tracks: [{ ...VIDEO.tracks[0]!, vssId: '.en', languageCode: 'en' }] };
    await loadSession(video, deps, new AbortController().signal, (state) => states.push(state));
    expect(states).toEqual([{ status: 'no-thai', video }]);
    expect(request).not.toHaveBeenCalled();
  });

  it('turns fetch failures into a user-facing error', async () => {
    const { deps } = fakeDeps({ fail: 'no-pot' });
    const states: SessionState[] = [];
    await loadSession(VIDEO, deps, new AbortController().signal, (state) => states.push(state));
    expect(states.at(-1)).toEqual({ status: 'error', video: VIDEO, error: 'unavailable' });

    const network = fakeDeps({ fail: 'network' });
    await loadSession(VIDEO, network.deps, new AbortController().signal, (state) =>
      states.push(state),
    );
    expect(states.at(-1)).toMatchObject({ error: 'network' });
  });

  it('reports an internal error when the service worker fails', async () => {
    const { deps, request } = fakeDeps();
    request.mockImplementation(() => Promise.reject(new RpcFailure('internal', 'boom')));
    const states: SessionState[] = [];
    await loadSession(VIDEO, deps, new AbortController().signal, (state) => states.push(state));
    expect(states.at(-1)).toMatchObject({ status: 'error', error: 'internal' });
  });

  it('keeps Thai when the English line fails', async () => {
    const { deps, fetchTracks } = fakeDeps();
    fetchTracks.mockImplementationOnce((_id, refs) =>
      Promise.resolve(refs.map((ref) => ({ ref, ok: true as const, body: BODIES[key(ref)]! }))),
    );
    fetchTracks.mockImplementationOnce((_id, refs) =>
      Promise.resolve(refs.map((ref) => ({ ref, ok: false as const, error: 'empty' as const }))),
    );
    const states: SessionState[] = [];
    await loadSession(VIDEO, deps, new AbortController().signal, (state) => states.push(state));
    expect(states.at(-1)).toMatchObject({ status: 'ready', english: { status: 'unavailable' } });
  });
});

describe('createSessionManager', () => {
  it('aborts the previous video and ignores repeats of the current one', async () => {
    const { deps, request } = fakeDeps();
    const states: SessionState[] = [];
    const manager = createSessionManager(deps, (state) => states.push(state));
    manager.setVideo(VIDEO);
    manager.setVideo(VIDEO);
    const other = { ...VIDEO, videoId: 'otherVideo1', tracks: [] };
    manager.setVideo(other);
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ status: 'no-thai', video: other }));
    // Nothing from the aborted first load arrives after the switch.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(states.at(-1)).toEqual({ status: 'no-thai', video: other });
    expect(request).toHaveBeenCalledTimes(1);

    manager.setVideo(null);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });
});
