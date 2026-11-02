import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPLAIN_WORD } from '@/src/ai/prompts/explain-word';
import { TRANSLATE_CUE } from '@/src/ai/prompts/translate-cue';
import { TAB_RATE_LIMIT } from '@/src/ai/service';
import type { AiProgress, ExplainWordParams, WordExplanation } from '@/src/messaging/ai';
import { createAiHarness, type AiHarness } from '../helpers/ai-harness';
import { API_KEY, LINE_ANSWER, WORD_ANSWER } from '../helpers/fake-openai';

const PARAMS: ExplainWordParams = {
  word: 'เรื่อง',
  line: { text: 'เรื่องนี้น่าสนใจ', translation: 'This is interesting' },
  before: [],
  after: ['ใช่ไหม'],
  videoTitle: 'Test video',
};

const responsesCalls = (h: AiHarness) =>
  h.openai.log.filter((request) => request.url.endsWith('/v1/responses'));

describe('AI service', () => {
  let h: AiHarness;
  beforeEach(async () => {
    h = await createAiHarness();
  });
  afterEach(() => h.dispose());

  it('is not ready and says why until something is set up', async () => {
    const before = h.openai.log.length;
    expect(await h.ai.status()).toEqual({ ready: false, provider: 'chatgpt-plan' });
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toEqual({
      status: 'error',
      error: { code: 'not-configured', provider: 'chatgpt-plan' },
    });
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS, { cachedOnly: true })).toEqual({ status: 'miss' });
    expect(h.openai.log).toHaveLength(before);
  });

  it('explains a word with the ChatGPT plan and caches the answer', async () => {
    await h.signIn();
    expect(await h.ai.status()).toEqual({ ready: true, provider: 'chatgpt-plan' });
    const progress: AiProgress<WordExplanation>[] = [];
    const result = await h.ai.run(EXPLAIN_WORD, PARAMS, { onProgress: (p) => progress.push(p) });
    expect(result).toMatchObject({
      status: 'ok',
      cached: false,
      provider: 'chatgpt-plan',
      // The default model: the first one OpenAI lists, as GPT-6-Luna isn't among them.
      model: 'gpt-fake-sol',
      value: {
        meaning: WORD_ANSWER.meaning_in_context,
        romanization: 'rʉ̂ʉang',
        syllables: [{ thai: 'เรื่อง', tone: 'falling' }],
        notes: null,
        classifier: 'เรื่อง',
      },
    });
    // The answer streamed in: the meaning showed before the end.
    expect(progress.some((p) => p.partial.meaning && !p.partial.exampleEn)).toBe(true);

    const body = h.openai.responsesBodies[0]!;
    expect(body).toMatchObject({ model: 'gpt-fake-sol', store: false, stream: true });
    expect(body.text).toMatchObject({
      format: { type: 'json_schema', name: 'thai_word_in_context', strict: true },
    });
    expect(Object.keys(body).sort()).toEqual(
      ['input', 'instructions', 'model', 'store', 'stream', 'text'].sort(),
    );
    expect(JSON.stringify(body.input)).not.toContain('"system"');

    // Again: from the cache, also with cachedOnly, without a request.
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ status: 'ok', cached: true });
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS, { cachedOnly: true })).toMatchObject({
      status: 'ok',
      cached: true,
    });
    expect(responsesCalls(h)).toHaveLength(1);
    // A different line is a different question.
    const other = { ...PARAMS, line: { text: 'เรื่องอื่น' } };
    expect(await h.ai.run(EXPLAIN_WORD, other, { cachedOnly: true })).toEqual({ status: 'miss' });
  });

  it('shows cached answers also after signing out', async () => {
    await h.signIn();
    await h.ai.run(EXPLAIN_WORD, PARAMS);
    await h.auth.signOut();
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS, { cachedOnly: true })).toMatchObject({
      status: 'ok',
      cached: true,
    });
  });

  it('defaults to GPT-6-Luna when OpenAI lists it, also for cache lookups', async () => {
    h.openai.options.planModels = [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list' },
      { slug: 'GPT-6-Luna', display_name: 'GPT-6-Luna', visibility: 'list' },
    ];
    await h.signIn();
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({
      status: 'ok',
      model: 'GPT-6-Luna',
    });
    expect(h.openai.responsesBodies[0]).toMatchObject({ model: 'GPT-6-Luna' });
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS, { cachedOnly: true })).toMatchObject({
      status: 'ok',
      cached: true,
      model: 'GPT-6-Luna',
    });
  });

  it('uses the chosen model and keys the cache on it', async () => {
    await h.signIn();
    h.settings.aiModelChatGpt = 'gpt-fake-luna';
    expect(await h.ai.run(TRANSLATE_CUE, PARAMS)).toMatchObject({
      status: 'ok',
      model: 'gpt-fake-luna',
      value: { natural: LINE_ANSWER.natural_en, literal: LINE_ANSWER.literal_en },
    });
    h.settings.aiModelChatGpt = 'gpt-fake-sol';
    expect(await h.ai.run(TRANSLATE_CUE, PARAMS, { cachedOnly: true })).toEqual({ status: 'miss' });
  });

  it('shares one stream between identical requests in flight', async () => {
    await h.signIn();
    const [a, b] = await Promise.all([
      h.ai.run(EXPLAIN_WORD, PARAMS),
      h.ai.run(EXPLAIN_WORD, PARAMS),
    ]);
    expect(a).toMatchObject({ status: 'ok' });
    // The second joined the first stream, or found its answer already cached.
    expect(b).toMatchObject({ status: 'ok', value: a.status === 'ok' ? a.value : null });
    expect(responsesCalls(h)).toHaveLength(1);
  });

  it('refreshes an expired access token before the request', async () => {
    await h.signIn();
    await h.auth.expire();
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ status: 'ok' });
    expect(h.openai.log.some((r) => r.body.includes('grant_type=refresh_token'))).toBe(true);
  });

  it('refreshes once and retries when OpenAI answers 401', async () => {
    await h.signIn();
    h.settings.aiModelChatGpt = 'gpt-fake-sol'; // no model list first: the 401 hits the stream
    // A token OpenAI no longer takes although it looks valid here.
    await h.credentials.updateChatGpt((c) =>
      c?.tokens ? { ...c, tokens: { ...c.tokens, accessToken: 'at.revoked' } } : c,
    );
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ status: 'ok' });
    expect(responsesCalls(h)).toHaveLength(2);
  });

  it('asks to sign in again when the refresh token is gone', async () => {
    await h.signIn();
    await h.auth.expire();
    h.openai.revokeAll();
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({
      status: 'error',
      error: { code: 'sign-in-again' },
    });
    expect(await h.ai.status()).toEqual({ ready: false, provider: 'chatgpt-plan' });
  });

  it('reports the usage limit, mid-stream too, with the response id', async () => {
    await h.signIn();
    h.openai.options.mode = 'usage-limit-mid-stream';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toEqual({
      status: 'error',
      error: {
        code: 'usage-limit',
        provider: 'chatgpt-plan',
        detail: expect.stringContaining('subscription_sharing_usage_limit_exceeded') as string,
        responseId: 'resp_fake123',
      },
    });
    h.openai.options.mode = 'usage-limit';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({
      error: { code: 'usage-limit' },
    });
  });

  it('falls back to the API key only when the user enabled it', async () => {
    await h.signIn();
    await h.credentials.setApiKey(API_KEY);
    h.settings.aiModelApiKey = 'gpt-fake-mini';
    h.openai.options.mode = 'usage-limit';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ error: { code: 'usage-limit' } });

    h.settings.aiFallbackToApiKey = true;
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({
      status: 'ok',
      provider: 'openai-api-key',
      model: 'gpt-fake-mini',
    });
    const last = h.openai.log.filter((r) => r.url.endsWith('/v1/responses')).at(-1)!;
    expect(last.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('uses the API key alone, once a model is chosen', async () => {
    h.settings.aiProvider = 'openai-api-key';
    await h.credentials.setApiKey(API_KEY);
    expect(await h.ai.status()).toEqual({ ready: false, provider: 'openai-api-key' });
    expect(await h.ai.listModels('openai-api-key')).toEqual([
      { slug: 'gpt-fake-mini', displayName: 'gpt-fake-mini' },
      { slug: 'gpt-fake-large', displayName: 'gpt-fake-large' },
    ]);
    h.settings.aiModelApiKey = 'gpt-fake-large';
    expect(await h.ai.status()).toEqual({ ready: true, provider: 'openai-api-key' });
    expect(await h.ai.run(TRANSLATE_CUE, PARAMS)).toMatchObject({
      status: 'ok',
      provider: 'openai-api-key',
    });
  });

  it('retries once when the answer does not match the schema', async () => {
    await h.signIn();
    h.openai.options.mode = 'bad-json';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({
      status: 'error',
      error: { code: 'bad-output' },
    });
    expect(responsesCalls(h)).toHaveLength(2);
  });

  it('reports broken and incomplete streams', async () => {
    await h.signIn();
    h.openai.options.mode = 'cut';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ error: { code: 'network' } });
    h.openai.options.mode = 'incomplete';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ error: { code: 'incomplete' } });
    h.openai.options.mode = 'unavailable';
    expect(await h.ai.run(EXPLAIN_WORD, PARAMS)).toMatchObject({ error: { code: 'unavailable' } });
  });

  it('limits requests per tab that reach OpenAI', async () => {
    await h.signIn();
    for (let i = 0; i < TAB_RATE_LIMIT; i++) {
      const params = { ...PARAMS, word: `w${i}` };
      expect(await h.ai.run(EXPLAIN_WORD, params, { tabId: 3 })).toMatchObject({ status: 'ok' });
    }
    expect(await h.ai.run(EXPLAIN_WORD, { ...PARAMS, word: 'x' }, { tabId: 3 })).toMatchObject({
      error: { code: 'rate-limited' },
    });
    // Cached answers and other tabs are not limited.
    expect(await h.ai.run(EXPLAIN_WORD, { ...PARAMS, word: 'w0' }, { tabId: 3 })).toMatchObject({
      status: 'ok',
      cached: true,
    });
    expect(await h.ai.run(EXPLAIN_WORD, { ...PARAMS, word: 'x' }, { tabId: 4 })).toMatchObject({
      status: 'ok',
    });
  });
});
