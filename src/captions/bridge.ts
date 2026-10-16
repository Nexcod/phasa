/**
 * Protocol between the MAIN-world script (player access) and the isolated
 * content script, over `window.postMessage` (docs/plan.md §4.1 step 4).
 *
 * The isolated script picks a random nonce and announces it with `hello`; both
 * sides then tag and check it on every message. Page scripts share the MAIN
 * world, so the nonce separates our traffic from other `message` events but is
 * not a secret: everything that crosses the bridge is validated as untrusted
 * input and carries no user data.
 */
import type { TrackInfo, TrackKind, TrackRef, VideoInfo } from './types';

export const BRIDGE_SOURCE = 'phasa-bridge';

export type ToMainMessage =
  { type: 'hello' } | { type: 'fetch'; requestId: number; videoId: string; refs: TrackRef[] };

export type FetchErrorCode =
  | 'no-pot' // the player never produced a usable PoToken for this video
  | 'empty' // YouTube answered with an empty body even after retries
  | 'http'
  | 'network'
  | 'unknown-track'
  | 'stale-video'; // the player moved on to another video

export type FetchResult =
  { ref: TrackRef; ok: true; body: string } | { ref: TrackRef; ok: false; error: FetchErrorCode };

export type ToIsolatedMessage =
  | { type: 'video'; video: VideoInfo | null }
  | { type: 'fetched'; requestId: number; videoId: string; results: FetchResult[] };

type Side = 'main' | 'isolated';

interface Envelope {
  source: typeof BRIDGE_SOURCE;
  to: Side;
  nonce: string;
  message: unknown;
}

export function envelope(
  to: Side,
  nonce: string,
  message: ToMainMessage | ToIsolatedMessage,
): Envelope {
  return { source: BRIDGE_SOURCE, to, nonce, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The nonce and payload of an envelope addressed to `side`, or null for any other message. */
export function openEnvelope(
  data: unknown,
  side: Side,
): { nonce: string; message: unknown } | null {
  if (!isRecord(data) || data.source !== BRIDGE_SOURCE || data.to !== side) return null;
  if (typeof data.nonce !== 'string' || data.nonce === '') return null;
  return { nonce: data.nonce, message: data.message };
}

const VIDEO_ID = /^[\w-]{6,20}$/u;
const MAX_TEXT = 500;
/** A 3-hour auto-generated json3 track is ~3 MB; anything far larger is not a caption track. */
export const MAX_BODY_CHARS = 16_000_000;

function str(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

export function isVideoId(value: unknown): value is string {
  return typeof value === 'string' && VIDEO_ID.test(value);
}

export function parseTrackRef(value: unknown): TrackRef | null {
  if (!isRecord(value)) return null;
  const vssId = str(value.vssId, 100);
  if (!vssId) return null;
  if (value.tlang === undefined) return { vssId };
  const tlang = str(value.tlang, 20);
  return tlang ? { vssId, tlang } : null;
}

function parseTrackInfo(value: unknown): TrackInfo | null {
  if (!isRecord(value)) return null;
  const vssId = str(value.vssId, 100);
  const languageCode = str(value.languageCode, 20);
  const kind: TrackKind | null =
    value.kind === 'asr' || value.kind === 'manual' ? value.kind : null;
  if (!vssId || !languageCode || !kind) return null;
  return {
    vssId,
    languageCode,
    kind,
    name: str(value.name) ?? '',
    isTranslatable: value.isTranslatable === true,
  };
}

export function parseVideoInfo(value: unknown): VideoInfo | null {
  if (!isRecord(value) || !isVideoId(value.videoId) || !Array.isArray(value.tracks)) return null;
  const durationSec = typeof value.durationSec === 'number' ? value.durationSec : 0;
  return {
    videoId: value.videoId,
    title: str(value.title, 1000) ?? '',
    channel: str(value.channel) ?? '',
    durationSec: Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0,
    isLive: value.isLive === true,
    tracks: (value.tracks as unknown[])
      .slice(0, 200)
      .map(parseTrackInfo)
      .filter((track): track is TrackInfo => track !== null),
  };
}

const ERROR_CODES = new Set<FetchErrorCode>([
  'no-pot',
  'empty',
  'http',
  'network',
  'unknown-track',
  'stale-video',
]);

function parseFetchResult(value: unknown): FetchResult | null {
  if (!isRecord(value)) return null;
  const ref = parseTrackRef(value.ref);
  if (!ref) return null;
  if (value.ok === true) {
    const body = str(value.body, MAX_BODY_CHARS);
    return body === null ? null : { ref, ok: true, body };
  }
  const error = value.error as FetchErrorCode;
  return ERROR_CODES.has(error) ? { ref, ok: false, error } : null;
}

export function parseToIsolated(message: unknown): ToIsolatedMessage | null {
  if (!isRecord(message)) return null;
  if (message.type === 'video') {
    if (message.video === null) return { type: 'video', video: null };
    const video = parseVideoInfo(message.video);
    return video ? { type: 'video', video } : null;
  }
  if (
    message.type === 'fetched' &&
    typeof message.requestId === 'number' &&
    isVideoId(message.videoId) &&
    Array.isArray(message.results)
  ) {
    const results = (message.results as unknown[]).map(parseFetchResult);
    if (results.some((result) => result === null)) return null;
    return {
      type: 'fetched',
      requestId: message.requestId,
      videoId: message.videoId,
      results: results as FetchResult[],
    };
  }
  return null;
}

export function parseToMain(message: unknown): ToMainMessage | null {
  if (!isRecord(message)) return null;
  if (message.type === 'hello') return { type: 'hello' };
  if (
    message.type === 'fetch' &&
    typeof message.requestId === 'number' &&
    isVideoId(message.videoId) &&
    Array.isArray(message.refs)
  ) {
    const refs = (message.refs as unknown[]).slice(0, 10).map(parseTrackRef);
    if (refs.some((ref) => ref === null)) return null;
    return {
      type: 'fetch',
      requestId: message.requestId,
      videoId: message.videoId,
      refs: refs as TrackRef[],
    };
  }
  return null;
}
