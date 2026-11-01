import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAiHandlers } from '@/src/background/ai';
import { createHandlers } from '@/src/background/handlers';
import type { AiProgress, ServerEvent, WordExplanation } from '@/src/messaging';
import { PORT_NAME, RpcFailure } from '@/src/messaging/protocol';
import { createClient } from '@/src/messaging/client';
import { createServer } from '@/src/messaging/server';
import { createAiHarness, type AiHarness } from '../helpers/ai-harness';
import { API_KEY, EMAIL } from '../helpers/fake-openai';
import { createPortPair } from '../helpers/fake-port';

const EXT = 'chrome-extension://abcdefghijklmnop';
const PAGE = { url: `${EXT}/options.html` };
const TAB = { url: 'https://www.youtube.com/watch?v=abc', tab: { id: 9 } };

const LINE = {
  line: { text: 'เรื่องนี้น่าสนใจ' },
  before: [],
  after: [],
  videoTitle: 'Video',
};

describe('AI and account methods', () => {
  let h: AiHarness;
  let events: ServerEvent[];
  let aiChanges: number;
  let opened: number;

  function connect(sender: { url: string; tab?: { id: number } }) {
    const handlers = createHandlers({
      db: () => h.db,
      swStartedAt: 1,
      broadcast: (event) => events.push(event),
      aiChanged: () => {
        aiChanges++;
      },
      ai: createAiHandlers({
        ai: h.ai,
        auth: h.auth,
        credentials: h.credentials,
        fetch: h.openai.fetch,
        openSettings: () => {
          opened++;
          return Promise.resolve();
        },
        devTools: false,
        aiChanged: () => {
          aiChanges++;
        },
      }),
    });
    const server = createServer(handlers, { extensionOrigin: EXT, swStartedAt: 1 });
    return createClient(() => {
      const [client, serverEnd] = createPortPair(PORT_NAME, sender);
      server.attach(serverEnd);
      return client;
    });
  }

  beforeEach(async () => {
    h = await createAiHarness();
    events = [];
    aiChanges = 0;
    opened = 0;
  });
  afterEach(() => h.dispose());

  it('keeps account methods away from content scripts', async () => {
    const tab = connect(TAB);
    for (const method of ['account/get', 'account/sign-in', 'account/set-api-key'] as const) {
      await expect(
        tab.request(method, method === 'account/set-api-key' ? { key: null } : {}),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    // A content script may ask for answers and open the settings.
    expect(await tab.request('ai/status', {})).toEqual({ ready: false, provider: 'chatgpt-plan' });
    await tab.request('ui/open-ai-settings', {});
    expect(opened).toBe(1);
  });

  it('streams an explanation to the tab that asked, and never shows a credential', async () => {
    await h.signIn();
    const tab = connect(TAB);
    const progress: AiProgress<WordExplanation>[] = [];
    const result = await tab.request(
      'ai/explain-word',
      { ...LINE, word: 'เรื่อง' },
      { timeoutMs: 0, onProgress: (p) => progress.push(p) },
    );
    expect(result).toMatchObject({ status: 'ok', provider: 'chatgpt-plan' });
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]?.provider).toBe('chatgpt-plan');

    const page = connect(PAGE);
    await h.credentials.setApiKey(API_KEY);
    const view = await page.request('account/get', {});
    expect(view).toMatchObject({
      chatgpt: { state: 'signed-in', email: EMAIL, planUsage: true },
      apiKey: { set: true, hint: 'sk-proj-…1234' },
      status: { ready: true },
    });
    const record = await h.credentials.chatGpt();
    const everything = JSON.stringify([view, result, progress]);
    for (const secret of [
      record?.tokens?.accessToken,
      record?.tokens?.refreshToken,
      record?.tokens?.idToken,
      API_KEY,
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('validates the line context', async () => {
    const tab = connect(TAB);
    const bad = [
      { ...LINE, word: '' },
      { ...LINE, word: 'x'.repeat(201) },
      { ...LINE, word: 'a', before: ['1', '2', '3'] },
      { ...LINE, word: 'a', line: { text: 5 } },
      { ...LINE, word: 'a', cachedOnly: 'yes' },
    ];
    for (const params of bad) {
      await expect(tab.request('ai/explain-word', params as never)).rejects.toBeInstanceOf(
        RpcFailure,
      );
    }
  });

  it('checks an API key before saving it', async () => {
    const page = connect(PAGE);
    expect(
      await page.request('account/set-api-key', { key: 'sk-proj-wrongwrongwrongwrong' }),
    ).toEqual({
      ok: false,
      error: 'invalid-key',
    });
    expect(await page.request('account/set-api-key', { key: 'short' })).toEqual({
      ok: false,
      error: 'invalid-key',
    });
    expect(await h.credentials.apiKey()).toBeUndefined();
    expect(await page.request('account/set-api-key', { key: ` ${API_KEY} ` })).toEqual({
      ok: true,
    });
    expect(await h.credentials.apiKey()).toBe(API_KEY);
    expect(aiChanges).toBe(1);
    expect(await page.request('account/models', { provider: 'openai-api-key' })).toEqual({
      models: [
        { slug: 'gpt-fake-mini', displayName: 'gpt-fake-mini' },
        { slug: 'gpt-fake-large', displayName: 'gpt-fake-large' },
      ],
    });
    await page.request('account/set-api-key', { key: null });
    expect(await h.credentials.apiKey()).toBeUndefined();
  });

  it('signs out through the account methods', async () => {
    await h.signIn();
    const page = connect(PAGE);
    expect(await page.request('account/sign-out', {})).toEqual({ revoked: true });
    expect((await page.request('account/get', {})).chatgpt).toMatchObject({
      state: 'signed-out',
      registered: true,
      email: EMAIL,
    });
    expect(aiChanges).toBeGreaterThan(0);
  });

  it('refuses the development token control in release builds', async () => {
    await expect(connect(PAGE).request('account/expire-token', {})).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('signals AI changes when an AI setting changes', async () => {
    const page = connect(PAGE);
    await page.request('settings/set', { patch: { showTranslation: false } });
    expect(aiChanges).toBe(0);
    await page.request('settings/set', { patch: { aiModelChatGpt: 'gpt-fake-luna' } });
    expect(aiChanges).toBe(1);
    await expect(
      page.request('settings/set', { patch: { aiModelChatGpt: 'bad model!' } }),
    ).rejects.toMatchObject({ code: 'bad_request' });
    expect(events.some((event) => event.type === 'settings/changed')).toBe(true);
  });
});
