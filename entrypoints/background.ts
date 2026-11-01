import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { createAiService, type ModelMemory } from '@/src/ai/service';
import { dbAiCache } from '@/src/ai/cache';
import { apiKeyProvider, chatGptProvider } from '@/src/ai/providers';
import { CALLBACK_PATH, loopbackRedirectRule, openTab, sessionAttempts } from '@/src/auth/browser';
import { createChatGptAuth } from '@/src/auth/chatgpt';
import { dbCredentialStore } from '@/src/auth/credentials';
import { openAiKeys, type KeySource } from '@/src/auth/id-token';
import { createAiHandlers } from '@/src/background/ai';
import { createHandlers } from '@/src/background/handlers';
import { getDb } from '@/src/db';
import { packagedFrequency } from '@/src/dictionary/frequency';
import { packagedSource } from '@/src/dictionary/store';
import { CHANGE_SIGNAL_KEY, PORT_NAME, type ServerEvent } from '@/src/messaging/protocol';
import { createServer } from '@/src/messaging/server';
import { settingsFromRows } from '@/src/settings';

/** The ChatGPT plan's default model, kept for cache lookups that must not go to the network. */
const modelMemory: ModelMemory = {
  async get(provider) {
    const value = (await getDb().meta.get(`aiDefaultModel:${provider}`))?.value;
    return typeof value === 'string' ? value : undefined;
  },
  async set(provider, slug) {
    await getDb().meta.put({ key: `aiDefaultModel:${provider}`, value: slug });
  },
};

export default defineBackground(() => {
  const swStartedAt = Date.now();

  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('[phasa] sidePanel.setPanelBehavior failed', error));

  // Handlers broadcast through the server created right below.
  let broadcast: (event: ServerEvent) => void = () => undefined;
  const packaged = (path: string) => browser.runtime.getURL(`/${path}` as '/');

  // AI (docs/plan.md §8, ADR 0003, ADR 0014): credentials stay in this service worker.
  const fetcher: typeof fetch = (input, init) => fetch(input, init);
  const credentials = dbCredentialStore(getDb);
  let keys: KeySource | undefined;
  const auth = createChatGptAuth({
    credentials,
    attempts: sessionAttempts,
    redirect: loopbackRedirectRule(browser.runtime.getURL(CALLBACK_PATH)),
    openTab,
    fetch: fetcher,
    keys: () => (keys ??= openAiKeys()),
    onChange: () => aiChanged(),
  });
  const ai = createAiService({
    providers: {
      'chatgpt-plan': chatGptProvider({ auth, fetch: fetcher }),
      'openai-api-key': apiKeyProvider({ credentials, fetch: fetcher }),
    },
    settings: async () => settingsFromRows(await getDb().settings.toArray()),
    cache: dbAiCache(getDb),
    models: modelMemory,
  });
  const aiChanged = () => {
    ai.status().then(
      (status) => broadcast({ type: 'ai/changed', status }),
      (error: unknown) => console.error('[phasa] AI status failed', error),
    );
  };
  auth.cleanup().catch((error: unknown) => console.error('[phasa] sign-in cleanup failed', error));
  const server = createServer(
    createHandlers({
      db: getDb,
      swStartedAt,
      dictionarySource: packagedSource(packaged),
      frequencySource: packagedFrequency(packaged),
      broadcast: (event) => broadcast(event),
      ai: createAiHandlers({
        ai,
        auth,
        credentials,
        fetch: fetcher,
        openSettings: async () => {
          await browser.tabs.create({ url: browser.runtime.getURL('/options.html#ai') });
        },
        devTools: import.meta.env.DEV,
        aiChanged,
      }),
      aiChanged,
    }),
    {
      extensionOrigin: self.location.origin,
      swStartedAt,
      onHandlerError: (method, error) => console.error(`[phasa] ${method} failed`, error),
    },
  );
  // Contexts whose port closed while the SW slept hear about the change through storage.
  let changes = 0;
  broadcast = (event) => {
    server.broadcast(event);
    browser.storage.local
      .set({ [CHANGE_SIGNAL_KEY]: `${swStartedAt}:${++changes}` })
      .catch((error: unknown) => console.error('[phasa] change signal failed', error));
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_NAME) server.attach(port);
  });
});
