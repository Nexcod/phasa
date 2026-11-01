/** The service-worker AI stack over the fake OpenAI and an in-memory database. */
import 'fake-indexeddb/auto';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { dbAiCache } from '@/src/ai/cache';
import { apiKeyProvider, chatGptProvider } from '@/src/ai/providers';
import { createAiService, type AiService } from '@/src/ai/service';
import { createChatGptAuth, type ChatGptAuth } from '@/src/auth/chatgpt';
import { dbCredentialStore, type CredentialStore } from '@/src/auth/credentials';
import type { SignInAttempt } from '@/src/auth/oauth';
import { PhasaDb } from '@/src/db/db';
import type { AiProviderId } from '@/src/messaging/ai';
import { DEFAULT_SETTINGS, type Settings } from '@/src/settings';
import { createFakeOpenAi, type FakeOpenAi } from './fake-openai';

export interface AiHarness {
  db: PhasaDb;
  openai: FakeOpenAi;
  auth: ChatGptAuth;
  credentials: CredentialStore;
  ai: AiService;
  settings: Settings;
  signIn(): Promise<void>;
  dispose(): Promise<void>;
}

let counter = 0;

export async function createAiHarness(options: { progressMs?: number } = {}): Promise<AiHarness> {
  const db = new PhasaDb(`ai-harness-${++counter}-${Date.now()}`);
  const openai = await createFakeOpenAi();
  const jwks = (await (
    await openai.fetch('https://auth.openai.com/.well-known/jwks.json')
  ).json()) as JSONWebKeySet;
  const credentials = dbCredentialStore(() => db);
  let attempt: SignInAttempt | undefined;
  let opened = '';
  const auth = createChatGptAuth({
    credentials,
    attempts: {
      get: () => Promise.resolve(attempt),
      set: (next) => {
        attempt = next;
        return Promise.resolve();
      },
      clear: () => {
        attempt = undefined;
        return Promise.resolve();
      },
    },
    redirect: { install: () => Promise.resolve(), remove: () => Promise.resolve() },
    openTab: (url) => {
      opened = url;
      return Promise.resolve();
    },
    fetch: openai.fetch,
    keys: () => createLocalJWKSet(jwks),
    retryDelayMs: 0,
  });
  const settings: Settings = { ...DEFAULT_SETTINGS };
  const remembered = new Map<AiProviderId, string>();
  const ai = createAiService({
    providers: {
      'chatgpt-plan': chatGptProvider({ auth, fetch: openai.fetch }),
      'openai-api-key': apiKeyProvider({ credentials, fetch: openai.fetch }),
    },
    settings: () => Promise.resolve({ ...settings }),
    cache: dbAiCache(() => db),
    models: {
      get: (provider) => Promise.resolve(remembered.get(provider)),
      set: (provider, slug) => {
        remembered.set(provider, slug);
        return Promise.resolve();
      },
    },
    progressMs: options.progressMs ?? 0,
  });
  return {
    db,
    openai,
    auth,
    credentials,
    ai,
    settings,
    async signIn() {
      await auth.begin();
      const redirect = await openai.authorize(opened);
      const result = await auth.complete(new URL(redirect).search);
      if (!result.ok) throw new Error(`sign-in failed: ${result.reason}`);
    },
    async dispose() {
      db.close();
      await db.delete();
    },
  };
}
