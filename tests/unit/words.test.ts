import { describe, expect, it, vi } from 'vitest';
import type { ProcessedCue } from '@/src/captions/types';
import { createWordManager, uniqueWords, type WordData } from '@/src/content/words';
import type { Client } from '@/src/messaging/client';
import {
  RpcFailure,
  type Method,
  type Params,
  type Result,
  type ServerEvent,
} from '@/src/messaging/protocol';
import type { Token } from '@/src/thai/types';

const cue = (text: string, startMs: number): ProcessedCue => ({
  startMs,
  endMs: startMs + 1000,
  text,
});

function tokensOf(text: string): Token[] {
  // Test tokenizer: words separated by '|' in the "text".
  let start = 0;
  return text.split('|').map((part) => {
    const token: Token = { text: part, start, end: start + part.length, kind: 'thai' };
    start += part.length;
    return token;
  });
}

function fakeClient(overrides: Partial<Record<Method, (params: never) => unknown>> = {}) {
  const listeners = new Set<(event: ServerEvent) => void>();
  const calls: { method: Method; params: unknown }[] = [];
  const handlers: Partial<Record<Method, (params: never) => unknown>> = {
    'thai/tokenize': ({ texts }: Params<'thai/tokenize'>) => ({
      tokens: texts.map(({ text }) => tokensOf(text)),
    }),
    'vocab/statuses': () => ({ statuses: { ผม: 'known' } }),
    'dict/lookup': ({ words }: Params<'dict/lookup'>) => ({
      results: words.map((thai) => ({ thai })),
    }),
    'vocab/set': () => ({ unit: {} }),
    ...overrides,
  };
  const client: Pick<Client, 'request' | 'onEvent'> = {
    request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
      calls.push({ method, params });
      try {
        return Promise.resolve(handlers[method]?.(params as never) as Result<M>);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (event: ServerEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { client, calls, emit };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('uniqueWords', () => {
  it('lists Thai words once, in order of appearance', () => {
    const space: Token = { text: ' ', start: 2, end: 3, kind: 'space' };
    expect(uniqueWords([tokensOf('ผม|ไป'), [space], tokensOf('ไป|บ้าน')])).toEqual([
      'ผม',
      'ไป',
      'บ้าน',
    ]);
  });
});

describe('createWordManager', () => {
  it('tokenizes the track, then loads statuses and prefetches lookups', async () => {
    const { client, calls } = fakeClient();
    let data: WordData | undefined;
    const manager = createWordManager(client, (next) => (data = next));
    manager.setTrack('v/a.th', [cue('ผม|ไป', 0), cue('ไป|บ้าน', 1000)]);
    await vi.waitFor(() => expect(data?.prefetched).toBe(true));
    expect(data?.tokens?.map((tokens) => tokens.map((token) => token.text))).toEqual([
      ['ผม', 'ไป'],
      ['ไป', 'บ้าน'],
    ]);
    expect(data?.statuses).toEqual({ ผม: 'known' });
    expect(manager.cached('บ้าน')).toEqual({ thai: 'บ้าน' });
    expect(calls.map((call) => call.method)).toEqual([
      'thai/tokenize',
      'vocab/statuses',
      'dict/lookup',
    ]);

    // Cached lookups need no request.
    await manager.lookup('บ้าน');
    expect(calls).toHaveLength(3);
  });

  it('follows vocab and segmentation broadcasts', async () => {
    const { client, calls, emit } = fakeClient();
    let data: WordData | undefined;
    const manager = createWordManager(client, (next) => (data = next));
    manager.setTrack('v/a.th', [cue('ผม|ไป', 0)]);
    await vi.waitFor(() => expect(data?.prefetched).toBe(true));

    emit({ type: 'vocab/changed', changes: [{ kind: 'word', thai: 'ไป', status: 2 }] });
    emit({ type: 'vocab/changed', changes: [{ kind: 'word', thai: 'ผม', status: null }] });
    expect(data?.statuses).toEqual({ ไป: 2 });

    emit({ type: 'segmentation/changed' });
    await settle();
    expect(calls.filter((call) => call.method === 'thai/tokenize')).toHaveLength(2);
  });

  it('updates a status optimistically and rolls back when saving fails', async () => {
    const { client } = fakeClient({
      'vocab/set': () => {
        throw new RpcFailure('internal', 'disk full');
      },
    });
    let data: WordData | undefined;
    const seen: (string | number | undefined)[] = [];
    const manager = createWordManager(client, (next) => {
      data = next;
      seen.push(next.statuses['ไป']);
    });
    manager.setTrack('v/a.th', [cue('ผม|ไป', 0)]);
    await vi.waitFor(() => expect(data?.prefetched).toBe(true));
    await expect(manager.setStatus('word', 'ไป', 1)).rejects.toThrow('disk full');
    expect(seen).toContain(1);
    expect(data?.statuses['ไป']).toBeUndefined();
  });

  it('drops results of a track that is no longer shown', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { client } = fakeClient({
      'thai/tokenize': async ({ texts }: Params<'thai/tokenize'>) => {
        if (texts[0]?.text === 'old') await gate;
        return { tokens: texts.map(({ text }) => tokensOf(text)) };
      },
    });
    let data: WordData | undefined;
    const manager = createWordManager(client, (next) => (data = next));
    manager.setTrack('old/a.th', [cue('old', 0)]);
    manager.setTrack('new/a.th', [cue('ใหม่', 0)]);
    await vi.waitFor(() => expect(data?.prefetched).toBe(true));
    release();
    await settle();
    expect(data?.trackId).toBe('new/a.th');
    expect(data?.tokens?.[0]?.[0]?.text).toBe('ใหม่');
  });
});
