/**
 * Loads the captions of the video the player reports (docs/plan.md §4.1):
 * cache → fetch through the MAIN world → process and cache in the service
 * worker → choose the Thai track → English second line. A new video aborts
 * the previous load.
 */
import type { FetchErrorCode, FetchResult } from '../captions/bridge';
import { alignTranslation, chooseThaiTrack, englishRef, thaiCandidates } from '../captions/tracks';
import {
  trackKey,
  type ProcessedTrack,
  type TrackInfo,
  type TrackKind,
  type TrackRef,
  type VideoInfo,
} from '../captions/types';
import type { Client } from '../messaging/client';
import type { MainBridge } from './main-bridge';

export type EnglishState =
  | { status: 'loading' }
  | { status: 'ready'; track: ProcessedTrack; lines: string[] }
  | { status: 'unavailable' };

/** What went wrong, coarse enough for a user-facing message. */
export type SessionError = 'unavailable' | 'network' | 'internal';

export type SessionState =
  | { status: 'idle' }
  | { status: 'loading'; video: VideoInfo }
  | { status: 'no-thai'; video: VideoInfo }
  | { status: 'error'; video: VideoInfo; error: SessionError }
  | {
      status: 'ready';
      video: VideoInfo;
      thai: ProcessedTrack;
      english: EnglishState;
      /** From the player reporting the video to Thai cues being ready. */
      loadMs: number;
    };

export interface SessionDeps {
  bridge: Pick<MainBridge, 'fetchTracks'>;
  client: Pick<Client, 'request'>;
  now: () => number;
}

interface FetchItem {
  ref: TrackRef;
  languageCode: string;
  kind: TrackKind;
}

class Aborted extends Error {}

/** A function, not a property read: TypeScript would otherwise keep `aborted` narrowed across awaits. */
function stopped(signal: AbortSignal): boolean {
  return signal.aborted;
}

function errorFor(codes: readonly (FetchErrorCode | 'parse')[]): SessionError {
  return codes.some((code) => code === 'network' || code === 'http') ? 'network' : 'unavailable';
}

async function fetchAndProcess(
  video: VideoInfo,
  items: readonly FetchItem[],
  deps: SessionDeps,
  signal: AbortSignal,
): Promise<{ tracks: ProcessedTrack[]; errors: (FetchErrorCode | 'parse')[] }> {
  const results: FetchResult[] = await deps.bridge.fetchTracks(
    video.videoId,
    items.map((item) => item.ref),
    signal,
  );
  if (stopped(signal)) throw new Aborted();
  const errors: (FetchErrorCode | 'parse')[] = [];
  const bodies: (FetchItem & { body: string })[] = [];
  for (const result of results) {
    const item = items.find((candidate) => trackKey(candidate.ref) === trackKey(result.ref));
    if (!item) continue;
    if (result.ok) bodies.push({ ...item, body: result.body });
    else errors.push(result.error);
  }
  if (bodies.length === 0) return { tracks: [], errors };
  const { videoId, title, channel, durationSec } = video;
  const processed = await deps.client.request(
    'captions/process',
    { video: { videoId, title, channel, durationSec }, items: bodies },
    { timeoutMs: 30_000 },
  );
  if (stopped(signal)) throw new Aborted();
  return {
    tracks: processed.tracks,
    errors: [...errors, ...processed.failed.map(() => 'parse' as const)],
  };
}

function itemFor(track: TrackInfo, ref: TrackRef = { vssId: track.vssId }): FetchItem {
  return { ref, languageCode: ref.tlang ?? track.languageCode, kind: track.kind };
}

/** Runs one video's load, reporting every state change. Throws nothing. */
export async function loadSession(
  video: VideoInfo,
  deps: SessionDeps,
  signal: AbortSignal,
  emit: (state: SessionState) => void,
  startedAt = deps.now(),
): Promise<void> {
  const candidates = thaiCandidates(video.tracks);
  if (candidates.length === 0) {
    emit({ status: 'no-thai', video });
    return;
  }
  emit({ status: 'loading', video });

  let thai: ProcessedTrack | null;
  let cached: Map<string, ProcessedTrack>;
  try {
    const { tracks } = await deps.client.request('captions/get', { videoId: video.videoId });
    if (stopped(signal)) return;
    cached = new Map(tracks.map((track) => [track.key, track]));
    const thaiTracks = candidates.flatMap((track) => cached.get(track.vssId) ?? []);
    const missing = candidates.filter((track) => !cached.has(track.vssId));
    let errors: (FetchErrorCode | 'parse')[] = [];
    if (missing.length > 0) {
      const fetched = await fetchAndProcess(
        video,
        missing.map((track) => itemFor(track)),
        deps,
        signal,
      );
      thaiTracks.push(...fetched.tracks);
      errors = fetched.errors;
    }
    thai = chooseThaiTrack(thaiTracks);
    if (!thai) {
      emit({ status: 'error', video, error: errorFor(errors) });
      return;
    }
  } catch (error) {
    if (error instanceof Aborted || stopped(signal)) return;
    const bridgeFailure = error instanceof Error && error.name === 'BridgeError';
    emit({ status: 'error', video, error: bridgeFailure ? 'network' : 'internal' });
    return;
  }

  const ready = { status: 'ready' as const, video, thai, loadMs: deps.now() - startedAt };
  emit({ ...ready, english: { status: 'loading' } });

  const thaiTrack = video.tracks.find((track) => track.vssId === thai.key);
  const ref = thaiTrack ? englishRef(video.tracks, thaiTrack) : null;
  const source = ref && video.tracks.find((track) => track.vssId === ref.vssId);
  if (!ref || !source) {
    emit({ ...ready, english: { status: 'unavailable' } });
    return;
  }
  try {
    const english =
      cached.get(trackKey(ref)) ??
      (await fetchAndProcess(video, [itemFor(source, ref)], deps, signal)).tracks[0];
    if (stopped(signal)) return;
    emit({
      ...ready,
      english: english
        ? { status: 'ready', track: english, lines: alignTranslation(thai.cues, english.cues) }
        : { status: 'unavailable' },
    });
  } catch {
    if (!stopped(signal)) emit({ ...ready, english: { status: 'unavailable' } });
  }
}

export interface SessionManager {
  /** The player's current video; a different video aborts the running load. */
  setVideo(video: VideoInfo | null): void;
  retry(): void;
  dispose(): void;
}

export function createSessionManager(
  deps: SessionDeps,
  emit: (state: SessionState) => void,
): SessionManager {
  let current: { video: VideoInfo; controller: AbortController } | null = null;

  const start = (video: VideoInfo, startedAt = deps.now()) => {
    current?.controller.abort();
    const controller = new AbortController();
    current = { video, controller };
    void loadSession(
      video,
      deps,
      controller.signal,
      (state) => {
        if (!stopped(controller.signal)) emit(state);
      },
      startedAt,
    );
  };

  return {
    setVideo(video) {
      if (video && video.videoId === current?.video.videoId) return;
      if (!video) {
        current?.controller.abort();
        current = null;
        emit({ status: 'idle' });
        return;
      }
      start(video);
    },
    retry() {
      if (current) start(current.video);
    },
    dispose() {
      current?.controller.abort();
      current = null;
    },
  };
}
