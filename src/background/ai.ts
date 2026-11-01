/**
 * Service-worker handlers of the AI and account methods (docs/plan.md §8, ADR 0014). Tokens and
 * the API key never appear in a result: the account view has the email and a key hint only.
 */
import type { ChatGptAuth } from '../auth/chatgpt';
import { keyHint, type CredentialStore } from '../auth/credentials';
import { AiFailure } from '../ai/errors';
import { EXPLAIN_WORD } from '../ai/prompts/explain-word';
import { TRANSLATE_CUE } from '../ai/prompts/translate-cue';
import { checkApiKey } from '../ai/providers';
import type { AiService } from '../ai/service';
import {
  MAX_CONTEXT_LINES,
  type AiLineContext,
  type AiProviderId,
  type AiStatus,
} from '../messaging/ai';
import { RpcFailure, type Method } from '../messaging/protocol';
import type { Handlers, RequestContext } from '../messaging/server';

export type AiMethod = Extract<
  Method,
  `ai/${string}` | `account/${string}` | 'ui/open-ai-settings'
>;
export type AiHandlers = Pick<Handlers, AiMethod>;

export interface AiHandlerDeps {
  ai: AiService;
  auth: ChatGptAuth;
  credentials: CredentialStore;
  fetch: typeof fetch;
  openSettings: () => Promise<void>;
  /** Development builds: `account/expire-token` works. */
  devTools: boolean;
  /** Tell every context that AI readiness may have changed. */
  aiChanged: () => void;
}

const MAX_LINE_CHARS = 2000;
const MAX_WORD_CHARS = 200;
const MAX_TITLE_CHARS = 300;

function badRequest(message: string): never {
  throw new RpcFailure('bad_request', message);
}

function text(value: unknown, max: number, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim() === '')) {
    badRequest(`Invalid ${field}`);
  }
  return value;
}

function lines(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_LINES) badRequest(`Invalid ${field}`);
  return (value as unknown[]).map((line) => text(line, MAX_LINE_CHARS, field, true));
}

function lineContext(params: unknown): AiLineContext {
  const { line, before, after, videoTitle } = (params ?? {}) as Record<string, unknown>;
  const { text: lineText, translation } = (line ?? {}) as Record<string, unknown>;
  const context: AiLineContext = {
    line: { text: text(lineText, MAX_LINE_CHARS, 'line') },
    before: lines(before, 'before'),
    after: lines(after, 'after'),
    videoTitle: text(videoTitle ?? '', MAX_TITLE_CHARS, 'videoTitle', true),
  };
  if (translation !== undefined && translation !== '') {
    context.line.translation = text(translation, MAX_LINE_CHARS, 'translation');
  }
  return context;
}

function cachedOnly(value: unknown): boolean {
  if (value !== undefined && typeof value !== 'boolean') badRequest('Invalid cachedOnly');
  return value === true;
}

function provider(value: unknown): AiProviderId {
  if (value !== 'chatgpt-plan' && value !== 'openai-api-key') badRequest('Invalid provider');
  return value;
}

/** Content scripts are rate limited per tab; extension pages are the user's own clicks. */
const rateKey = (context: RequestContext) =>
  context.origin === 'content-script' ? (context.tabId ?? -1) : undefined;

/** A pasted platform key: printable ASCII, no spaces. */
const API_KEY_PATTERN = /^[\x21-\x7e]{20,300}$/;

export function createAiHandlers(deps: AiHandlerDeps): AiHandlers {
  return {
    'ai/status': () => deps.ai.status(),

    'ai/explain-word': async (params, context) => {
      const tabId = rateKey(context);
      return deps.ai.run(
        EXPLAIN_WORD,
        { ...lineContext(params), word: text(params.word, MAX_WORD_CHARS, 'word') },
        {
          cachedOnly: cachedOnly(params.cachedOnly),
          ...(context.progress ? { onProgress: context.progress } : {}),
          ...(tabId === undefined ? {} : { tabId }),
        },
      );
    },

    'ai/translate-cue': async (params, context) => {
      const tabId = rateKey(context);
      return deps.ai.run(TRANSLATE_CUE, lineContext(params), {
        cachedOnly: cachedOnly(params.cachedOnly),
        ...(context.progress ? { onProgress: context.progress } : {}),
        ...(tabId === undefined ? {} : { tabId }),
      });
    },

    'ui/open-ai-settings': async () => {
      await deps.openSettings();
      return {};
    },

    'account/get': async () => {
      const key = await deps.credentials.apiKey();
      return {
        chatgpt: await deps.auth.view(),
        apiKey: key ? { set: true, hint: keyHint(key) } : { set: false },
        status: await deps.ai.status(),
      };
    },

    'account/sign-in': async () => {
      await deps.auth.begin();
      return {};
    },

    'account/callback': async ({ search }) => {
      const result = await deps.auth.complete(text(search, 8000, 'search'));
      deps.aiChanged();
      return result;
    },

    'account/sign-out': async () => {
      deps.ai.abortAll(new AiFailure('not-configured', 'Signed out'));
      const result = await deps.auth.signOut();
      deps.aiChanged();
      return result;
    },

    'account/forget': async () => {
      deps.ai.abortAll(new AiFailure('not-configured', 'Signed out'));
      const result = await deps.auth.forget();
      deps.aiChanged();
      return result;
    },

    'account/set-api-key': async ({ key }) => {
      if (key === null) {
        await deps.credentials.setApiKey(null);
        deps.aiChanged();
        return { ok: true };
      }
      const trimmed = text(key, 400, 'key').trim();
      if (!API_KEY_PATTERN.test(trimmed)) return { ok: false, error: 'invalid-key' };
      const check = await checkApiKey(deps.fetch, trimmed);
      if (check !== 'ok') return { ok: false, error: check };
      await deps.credentials.setApiKey(trimmed);
      deps.aiChanged();
      return { ok: true };
    },

    'account/models': async (params) => {
      try {
        return { models: await deps.ai.listModels(provider(params.provider)) };
      } catch (error) {
        if (error instanceof RpcFailure) throw error;
        return { error: error instanceof AiFailure ? error.code : 'failed' };
      }
    },

    'account/expire-token': async () => {
      if (!deps.devTools) throw new RpcFailure('forbidden', 'Development builds only');
      await deps.auth.expire();
      return {};
    },
  };
}

/** Before AI is wired (tests of other handlers): nothing is configured. */
export function disabledAiHandlers(): AiHandlers {
  const status: AiStatus = { ready: false, provider: 'chatgpt-plan' };
  const unavailable = () => {
    throw new RpcFailure('internal', 'AI is not available');
  };
  const notConfigured = () =>
    Promise.resolve({
      status: 'error' as const,
      error: { code: 'not-configured' as const, provider: 'chatgpt-plan' as const },
    });
  return {
    'ai/status': () => status,
    'ai/explain-word': notConfigured,
    'ai/translate-cue': notConfigured,
    'ui/open-ai-settings': unavailable,
    'account/get': unavailable,
    'account/sign-in': unavailable,
    'account/callback': unavailable,
    'account/sign-out': unavailable,
    'account/forget': unavailable,
    'account/set-api-key': unavailable,
    'account/models': unavailable,
    'account/expire-token': unavailable,
  };
}
