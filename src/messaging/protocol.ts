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

import type { ProcessedTrack, TrackKind, TrackRef } from '../captions/types';
import type { Settings } from '../settings';

export const PORT_NAME = 'phasa';
export const PROTOCOL_VERSION = 2;

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

export type ServerEvent = HelloEvent | SettingsChangedEvent;

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
