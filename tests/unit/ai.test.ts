import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiFailure, failureFromHttp } from '@/src/ai/errors';
import { parsePartialJson } from '@/src/ai/partial-json';
import { EXPLAIN_WORD } from '@/src/ai/prompts/explain-word';
import { TRANSLATE_CUE } from '@/src/ai/prompts/translate-cue';
import { apiKeyModels, chatGptModels } from '@/src/ai/providers';
import {
  FORBIDDEN_FIELDS,
  checkBody,
  readResponseStream,
  streamResponses,
  type ResponsesBody,
  type StreamEvent,
} from '@/src/ai/responses';
import { validate } from '@/src/ai/schema';
import { parseSse, type SseMessage } from '@/src/ai/sse';
import { LINE_ANSWER, WORD_ANSWER, responseStream } from '../helpers/fake-openai';

const FIXTURES = join(import.meta.dirname, '../fixtures/responses');

async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) {
    await Promise.resolve(); // chunks arrive one by one
    yield text.slice(i, i + size);
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

async function events(text: string, size = 7): Promise<StreamEvent[]> {
  return collect(readResponseStream(parseSse(chunked(text, size))));
}

describe('parseSse', () => {
  it('splits messages on blank lines whatever the chunk boundaries', async () => {
    const text = 'event: a\ndata: 1\n\n: comment\ndata: x\ndata: y\r\n\r\ndata:z\rdata: w\r\r';
    for (const size of [1, 2, 3, 5, 100]) {
      expect(await collect(parseSse(chunked(text, size)))).toEqual<SseMessage[]>([
        { event: 'a', data: '1' },
        { data: 'x\ny' },
        { data: 'z\nw' },
      ]);
    }
  });

  it('flushes a last message without a trailing blank line', async () => {
    expect(await collect(parseSse(chunked('data: end', 3)))).toEqual([{ data: 'end' }]);
  });
});

describe('Responses stream', () => {
  it('reads the contract fixture to its completed text', async () => {
    const result = await events(readFileSync(join(FIXTURES, 'completed.sse'), 'utf8'));
    expect(result[0]).toEqual({ type: 'started', responseId: 'resp_0a1b2c3d' });
    const completed = result.at(-1);
    expect(completed?.type).toBe('completed');
    const text = completed?.type === 'completed' ? completed.text : '';
    const answer: unknown = JSON.parse(text);
    expect(validate(TRANSLATE_CUE.schema, answer)).toEqual([]);
    expect(TRANSLATE_CUE.fromJson(answer).words).toEqual([
      { thai: 'สวัสดี', en: 'hello' },
      { thai: 'ครับ', en: 'polite particle (male speaker)' },
    ]);
  });

  it('fails with the usage limit that arrives mid-stream', async () => {
    const stream = readFileSync(join(FIXTURES, 'usage-limit.sse'), 'utf8');
    const seen: StreamEvent[] = [];
    const error = await (async () => {
      try {
        for await (const event of readResponseStream(parseSse(chunked(stream, 11))))
          seen.push(event);
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(seen.map((event) => event.type)).toEqual(['started', 'delta']);
    expect(error).toBeInstanceOf(AiFailure);
    expect(error).toMatchObject({ code: 'usage-limit', responseId: 'resp_9z8y7x' });
  });

  it('treats a stream without a terminal event as broken', async () => {
    await expect(events(responseStream('{"a":1}', 'cut'))).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('reports response.incomplete with its reason', async () => {
    await expect(events(responseStream('{"a":1}', 'incomplete'))).rejects.toMatchObject({
      code: 'incomplete',
      detail: 'content_filter',
    });
  });
});

describe('streamResponses', () => {
  /** A stream that sends `response.created` and then nothing. */
  const hanging = (() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.created","response":{"id":"resp_h"}}\n\n',
              ),
            );
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )) as typeof fetch;
  const body: ResponsesBody = {
    model: 'm',
    instructions: 'i',
    input: [{ role: 'user', content: 'x' }],
    store: false,
    stream: true,
  };

  it('gives up when nothing arrives for the idle time', async () => {
    const stream = streamResponses({
      fetch: hanging,
      provider: 'chatgpt-plan',
      token: 't',
      body,
      idleMs: 30,
    });
    await expect(collect(stream)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('stops with the reason it was aborted for (sign-out)', async () => {
    const controller = new AbortController();
    const stream = streamResponses({
      fetch: hanging,
      provider: 'chatgpt-plan',
      token: 't',
      body,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new AiFailure('not-configured', 'Signed out')), 10);
    await expect(collect(stream)).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('sends the token only in the Authorization header', async () => {
    let seen: RequestInit | undefined;
    const capture = ((_url: string, init: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response(responseStream('{}'), { status: 200 }));
    }) as unknown as typeof fetch;
    await collect(
      streamResponses({ fetch: capture, provider: 'chatgpt-plan', token: 'secret', body }),
    );
    expect(new Headers(seen?.headers).get('authorization')).toBe('Bearer secret');
    expect(seen?.body as string).not.toContain('secret');
  });
});

describe('request rules (preview limitations)', () => {
  const body: ResponsesBody = {
    model: 'm',
    instructions: 'i',
    input: [{ role: 'user', content: 'x' }],
    store: false,
    stream: true,
  };

  it('accepts a plain body and rejects forbidden fields, system messages and storage', () => {
    expect(() => checkBody(body as unknown as Record<string, unknown>)).not.toThrow();
    for (const field of FORBIDDEN_FIELDS) {
      expect(() => checkBody({ ...body, [field]: 1 })).toThrow(field);
    }
    expect(() => checkBody({ ...body, store: true })).toThrow();
    expect(() => checkBody({ ...body, stream: false })).toThrow();
    expect(() => checkBody({ ...body, input: [{ role: 'system', content: 'x' }] })).toThrow();
  });

  it('does not compile with a forbidden field', () => {
    // @ts-expect-error temperature is rejected on the ChatGPT-plan route
    const bad: ResponsesBody = { ...body, temperature: 0 };
    expect(bad).toBeDefined();
  });
});

describe('error mapping', () => {
  it('maps OpenAI codes and bare statuses', () => {
    const http = (status: number, body: unknown, provider = 'chatgpt-plan' as const) =>
      failureFromHttp(status, JSON.stringify(body), provider).code;
    expect(http(429, { error: { code: 'subscription_sharing_usage_limit_exceeded' } })).toBe(
      'usage-limit',
    );
    expect(http(503, { error: { code: 'subscription_sharing_usage_unavailable' } })).toBe(
      'unavailable',
    );
    expect(http(403, { error: { code: 'subscription_sharing_user_not_eligible' } })).toBe(
      'not-eligible',
    );
    expect(
      http(400, { error: { code: 'subscription_sharing_unsupported_capability', param: 'tools' } }),
    ).toBe('unsupported');
    expect(http(403, { detail: 'Region not supported' })).toBe('blocked');
    expect(http(503, { detail: 'Direct routing unavailable' })).toBe('unavailable');
    expect(http(401, { error: { code: 'invalid_api_key' } }, 'openai-api-key' as never)).toBe(
      'invalid-key',
    );
    expect(http(429, { error: { code: 'insufficient_quota' } })).toBe('quota');
    expect(failureFromHttp(403, '{"detail":"Region"}', 'chatgpt-plan').detail).toBe('Region');
  });
});

describe('partial JSON', () => {
  it('reads what has arrived of an answer', () => {
    const full = JSON.stringify(WORD_ANSWER);
    for (let end = 0; end <= full.length; end++) {
      expect(() => parsePartialJson(full.slice(0, end))).not.toThrow();
    }
    expect(parsePartialJson(full)).toEqual(WORD_ANSWER);
    expect(parsePartialJson('{"meaning_in_context":"a sto')).toEqual({
      meaning_in_context: 'a sto',
    });
    expect(parsePartialJson('{"a":"x","b')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":"x","b":')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":tr')).toEqual({});
    expect(parsePartialJson('{"a":[{"t":"ส"},{"t"')).toEqual({ a: [{ t: 'ส' }, {}] });
    expect(parsePartialJson('{"a":"\\u0e2a\\u0e')).toEqual({ a: 'ส' });
    expect(parsePartialJson('')).toBeUndefined();
  });

  it('turns a partial word explanation into the fields it already has', () => {
    const text = JSON.stringify(WORD_ANSWER);
    const cut = text.indexOf('"syllables"') + 20;
    const partial = EXPLAIN_WORD.partial(parsePartialJson(text.slice(0, cut)));
    expect(partial.meaning).toBe(WORD_ANSWER.meaning_in_context);
    expect(partial.romanization).toBe('rʉ̂ʉang');
    expect(partial.syllables).toBeUndefined(); // not until the list is closed
  });

  it('shows only finished words of a word-by-word list', () => {
    const text = JSON.stringify(LINE_ANSWER);
    const cut = text.indexOf('"คิด"') + 3;
    expect(TRANSLATE_CUE.partial(parsePartialJson(text.slice(0, cut))).words).toEqual([
      { thai: 'ฝรั่ง', en: 'Westerner' },
    ]);
  });
});

describe('prompts', () => {
  const context = {
    line: { text: 'ฝรั่งคิดยังไงกับภาษาไทย', translation: 'What do foreigners think?' },
    before: ['สวัสดีครับ'],
    after: [],
    videoTitle: 'Thai\nvideo',
  };

  it('validate the schema they send', () => {
    expect(validate(EXPLAIN_WORD.schema, WORD_ANSWER)).toEqual([]);
    expect(validate(TRANSLATE_CUE.schema, LINE_ANSWER)).toEqual([]);
    expect(validate(EXPLAIN_WORD.schema, { ...WORD_ANSWER, extra: 1 })).toContain(
      '/extra: unexpected',
    );
    expect(
      validate(EXPLAIN_WORD.schema, { ...WORD_ANSWER, syllables: [{ thai: 'x', tone: 'up' }] }),
    ).toHaveLength(1);
  });

  it('put the line, its neighbours and the word in the user message', () => {
    const input = EXPLAIN_WORD.input({ ...context, word: 'คิด' });
    expect(input).toContain('Video title: Thai video');
    expect(input).toContain('Previous lines:\n- สวัสดีครับ');
    expect(input).toContain('Line: ฝรั่งคิดยังไงกับภาษาไทย');
    expect(input).toContain(
      'English subtitle (may be machine-translated): What do foreigners think?',
    );
    expect(input).not.toContain('Next lines');
    expect(input.endsWith('Word or phrase: คิด')).toBe(true);
  });

  it('key the cache on what the answer depends on', () => {
    const a = EXPLAIN_WORD.cacheInput({ ...context, word: 'คิด' });
    const b = EXPLAIN_WORD.cacheInput({ ...context, word: 'คิด', cachedOnly: true });
    const c = EXPLAIN_WORD.cacheInput({ ...context, word: 'ไทย' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });
});

describe('models', () => {
  it('lists the ChatGPT plan models with visibility "list", in the server order', () => {
    expect(
      chatGptModels({
        models: [
          { slug: 'b', display_name: 'B', visibility: 'list' },
          { slug: 'h', display_name: 'H', visibility: 'hide' },
          { slug: 'a', display_name: 'A', visibility: 'list' },
        ],
      }),
    ).toEqual([
      { slug: 'b', displayName: 'B' },
      { slug: 'a', displayName: 'A' },
    ]);
  });

  it('lists text models of an API key, newest first', () => {
    expect(
      apiKeyModels({
        data: [
          { id: 'gpt-4o', created: 1 },
          { id: 'text-embedding-3-large', created: 9 },
          { id: 'gpt-4o-realtime-preview', created: 8 },
          { id: 'o4-mini', created: 5 },
          { id: 'dall-e-3', created: 7 },
        ],
      }).map((model) => model.slug),
    ).toEqual(['o4-mini', 'gpt-4o']);
  });
});
