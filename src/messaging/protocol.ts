/**
 * Typed protocol between extension contexts and the service worker.
 *
 * Every context talks to the SW over a long-lived `chrome.runtime.Port` named
 * {@link PORT_NAME}. Clients send {@link RequestEnvelope}s, the SW answers with
 * {@link ResponseEnvelope}s and may push {@link EventEnvelope}s at any time.
 *
 * To add a method: extend {@link Methods}, list who may call it in
 * {@link METHOD_ACCESS}, implement it in `src/background/handlers.ts`.
 */

import type { VideoAnalysis } from '../analysis/types';
import type { ProcessedTrack, TrackKind, TrackRef } from '../captions/types';
import type { WordInfo } from '../dictionary/types';
import type { Settings } from '../settings';
import type { Token } from '../thai/types';
import type {
  BulkMode,
  ContextInput,
  FrequentWord,
  SavedUnit,
  SegRule,
  SegRuleKind,
  UnitKind,
  VocabChange,
  VocabCounts,
  WordStatus,
} from '../vocab/types';

export const PORT_NAME = 'phasa';
export const PROTOCOL_VERSION = 4;

/**
 * `chrome.storage.local` key the SW bumps with every broadcast. A context whose port closed while
 * the SW was asleep would miss the event; storage changes reach every context, so it reconnects,
 * and the `sw/hello` it gets makes it reload (src/messaging/browser.ts).
 */
export const CHANGE_SIGNAL_KEY = 'phasaChanged';

/** Request size limits, checked by the handlers. */
export const MAX_TOKENIZE_TEXTS = 2000;
export const MAX_LOOKUP_WORDS = 500;
export const MAX_STATUS_WORDS = 5000;
/** A `vocab/changed` event lists at most this many changes; beyond, it asks to reload. */
export const MAX_EVENT_CHANGES = 1000;

/** Where a request comes from. Derived by the SW from `port.sender`, never trusted from the payload. */
export type Origin = 'content-script' | 'extension-page';

export interface DbInfo {
  schemaVersion: number;
  counts: Record<string, number>;
}

/** Raw timedtext bodies fetched in the page, processed and cached by the SW. */
export interface CaptionsProcessParams {
  video: { videoId: string; title: string; channel: string; durationSec: number };
  items: { ref: TrackRef; languageCode: string; kind: TrackKind; body: string }[];
}

export interface CaptionsProcessResult {
  tracks: ProcessedTrack[];
  /** Bodies that could not be parsed, by track key. */
  failed: { key: string; error: string }[];
}

export interface Methods {
  ping: {
    params: { sentAt: number };
    result: { sentAt: number; swStartedAt: number };
  };
  'db/info': {
    params: Record<string, never>;
    result: DbInfo;
  };
  /** Cached tracks of a video (current processing version only). */
  'captions/get': {
    params: { videoId: string };
    result: { tracks: ProcessedTrack[] };
  };
  'captions/process': {
    params: CaptionsProcessParams;
    result: CaptionsProcessResult;
  };
  'settings/get': {
    params: Record<string, never>;
    result: Settings;
  };
  /** Validated partial update; broadcasts `settings/changed`. */
  'settings/set': {
    params: { patch: Partial<Settings> };
    result: Settings;
  };
  /** Word tokens of normalized Thai texts (cue text + zero-width hints), with the user's rules. */
  'thai/tokenize': {
    params: { texts: { text: string; hints?: number[] }[] };
    result: { tokens: Token[][] };
  };
  /** Dictionary entry, pronunciation and parts of each word. */
  'dict/lookup': {
    params: { words: string[] };
    result: { results: WordInfo[] };
  };
  /** Statuses of saved words and phrases among `words`; unsaved ones are new and left out. */
  'vocab/statuses': {
    params: { words: string[] };
    result: { statuses: Record<string, WordStatus> };
  };
  /** Saves a word or phrase with a status and optionally the context; broadcasts `vocab/changed`. */
  'vocab/set': {
    params: { kind: UnitKind; thai: string; status: WordStatus; context?: ContextInput };
    result: { unit: SavedUnit };
  };
  'vocab/delete': {
    params: { kind: UnitKind; thai: string };
    result: { deleted: boolean };
  };
  /** Saved words and phrases, most recently changed first. */
  'vocab/list': {
    params: { kind?: UnitKind; videoId?: string; query?: string; limit?: number; offset?: number };
    result: { units: SavedUnit[]; total: number };
  };
  /** Saved words by status (onboarding). */
  'vocab/counts': {
    params: Record<string, never>;
    result: VocabCounts;
  };
  /**
   * Sets the status of many words (onboarding, import); broadcasts `vocab/changed`. With `split`,
   * each entry is normalized and split into words first (a word list from elsewhere).
   */
  'vocab/bulk-set': {
    params: { words: string[]; status: WordStatus; mode: BulkMode; split?: boolean };
    result: { changed: number; words: number };
  };
  /** The `count` most frequent words that are one unit in the subtitles (onboarding). */
  'vocab/frequent': {
    params: { count: number };
    result: { words: FrequentWord[] };
  };
  /** Coverage, level and new words of a video's Thai track; null until the track is cached. */
  'analysis/video': {
    params: { videoId: string; trackKey: string };
    result: { analysis: VideoAnalysis | null };
  };
  /**
   * Sets the status of the video's new words: all of them, the `top` N best to learn, or the given
   * `words`. Learning words are saved with the line they first occur in (and its translation from
   * `englishKey`). Broadcasts `vocab/changed`.
   */
  'analysis/mark-new': {
    params: {
      videoId: string;
      trackKey: string;
      englishKey?: string;
      status: WordStatus;
      top?: number;
      words?: string[];
    };
    result: { changed: number };
  };
  'segrules/list': {
    params: Record<string, never>;
    result: { rules: SegRule[] };
  };
  /** Adds a merge or split rule; broadcasts `segmentation/changed`. */
  'segrules/add': {
    params: { kind: SegRuleKind; parts: string[] };
    result: { rule: SegRule };
  };
  'segrules/delete': {
    params: { key: string };
    result: { deleted: boolean };
  };
}

export type Method = keyof Methods;
export type Params<M extends Method> = Methods[M]['params'];
export type Result<M extends Method> = Methods[M]['result'];

/**
 * Methods that touch OpenAI credentials must be `['extension-page']` only:
 * tokens never reach content scripts (docs/plan.md §3.2, §8.7).
 */
export const METHOD_ACCESS: Readonly<Record<Method, readonly Origin[]>> = {
  ping: ['content-script', 'extension-page'],
  'db/info': ['content-script', 'extension-page'],
  'captions/get': ['content-script', 'extension-page'],
  'captions/process': ['content-script', 'extension-page'],
  'settings/get': ['content-script', 'extension-page'],
  'settings/set': ['content-script', 'extension-page'],
  'thai/tokenize': ['content-script', 'extension-page'],
  'dict/lookup': ['content-script', 'extension-page'],
  'vocab/statuses': ['content-script', 'extension-page'],
  'vocab/set': ['content-script', 'extension-page'],
  'vocab/delete': ['content-script', 'extension-page'],
  'vocab/list': ['content-script', 'extension-page'],
  'vocab/counts': ['extension-page'],
  'vocab/bulk-set': ['extension-page'],
  'vocab/frequent': ['extension-page'],
  'analysis/video': ['content-script', 'extension-page'],
  'analysis/mark-new': ['content-script', 'extension-page'],
  'segrules/list': ['content-script', 'extension-page'],
  'segrules/add': ['content-script', 'extension-page'],
  'segrules/delete': ['content-script', 'extension-page'],
};

/** Sent on every new connection; a changed `swStartedAt` means the SW restarted. */
export interface HelloEvent {
  type: 'sw/hello';
  protocol: number;
  swStartedAt: number;
}

export interface SettingsChangedEvent {
  type: 'settings/changed';
  settings: Settings;
}

/** Saved words or phrases changed (status set or deleted). */
export interface VocabChangedEvent {
  type: 'vocab/changed';
  changes: VocabChange[];
  /** More than {@link MAX_EVENT_CHANGES} changed: `changes` is empty, reload the statuses. */
  reload?: true;
}

/** Word boundaries may differ now: user rules or phrases changed. Re-tokenize. */
export interface SegmentationChangedEvent {
  type: 'segmentation/changed';
}

export type ServerEvent =
  HelloEvent | SettingsChangedEvent | VocabChangedEvent | SegmentationChangedEvent;

export type RequestEnvelope = {
  [M in Method]: { kind: 'request'; id: number; method: M; params: Params<M> };
}[Method];

export type RpcErrorCode =
  'unknown_method' | 'bad_request' | 'forbidden' | 'internal' | 'disconnected' | 'timeout';

export interface RpcError {
  code: RpcErrorCode;
  message: string;
}

export type ResponseEnvelope =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: RpcError };

export interface EventEnvelope {
  kind: 'event';
  event: ServerEvent;
}

export type ServerMessage = ResponseEnvelope | EventEnvelope;

export class RpcFailure extends Error {
  constructor(
    readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RpcFailure';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isMethod(value: unknown): value is Method {
  return typeof value === 'string' && Object.hasOwn(METHOD_ACCESS, value);
}

/** Shape check only; per-method params are validated by handlers. */
export function parseRequest(
  value: unknown,
): { ok: true; request: RequestEnvelope } | { ok: false; id: number | null; error: RpcError } {
  if (!isRecord(value) || value.kind !== 'request' || typeof value.id !== 'number') {
    return { ok: false, id: null, error: { code: 'bad_request', message: 'Malformed envelope' } };
  }
  if (!isMethod(value.method)) {
    return {
      ok: false,
      id: value.id,
      error: { code: 'unknown_method', message: `Unknown method: ${String(value.method)}` },
    };
  }
  if (!isRecord(value.params)) {
    return {
      ok: false,
      id: value.id,
      error: { code: 'bad_request', message: 'params must be an object' },
    };
  }
  return { ok: true, request: value as unknown as RequestEnvelope };
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value)) return false;
  if (value.kind === 'response')
    return typeof value.id === 'number' && typeof value.ok === 'boolean';
  if (value.kind === 'event') return isRecord(value.event) && typeof value.event.type === 'string';
  return false;
}
